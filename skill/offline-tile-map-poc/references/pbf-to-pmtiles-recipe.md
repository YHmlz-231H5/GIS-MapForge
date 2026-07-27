# PBF → PMTiles Conversion Recipe (Windows-friendly)

Captured during a session where the user supplied an 887 MB Australia OSM PBF (`australia-260404.osm.pbf`, Geofabrik-style naming) and asked to convert it to PMTiles. This is the proven pure-Python path that works on Windows when no `tippecanoe`/`osmium-tool`/GDAL binary is available.

## Why this path

On Windows (as of 2026), the standard OSM → PMTiles tools do not ship binaries:

| Tool | Linux/macOS binary | Windows binary |
|---|---|---|
| `tippecanoe` | ✅ | ❌ (build from source only) |
| `osmium-tool` (CLI) | ✅ | ❌ |
| GDAL `ogr2ogr` | ✅ | ❌ in GitHub release (only via OSGeo4W installer, large) |
| `pyrosm` | ✅ | ❌ (needs MSVC for `cykhash` C ext) |
| `osmium` (Python bindings to libosmium) | ✅ | ✅ via pip wheel |
| `pmtiles` Python package | ✅ | ✅ via pip |
| `mapbox_vector_tile` | ✅ | ✅ via pip |

So the only working all-Python Windows pipeline is **`osmium` → GeoJSON → `mapbox_vector_tile` → `pmtiles.Writer`**.

## Install

```bash
# Default pypi (may be slow / time out from China-region IPs):
python -m pip install osmium mapbox-vector-tile pmtiles shapely numpy

# Tsinghua mirror (much faster for users in CN):
python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple osmium mapbox-vector-tile pmtiles shapely numpy
```

`pyrosm` is the obvious-looking choice but its `cykhash` C extension requires MSVC to build — fails on stock Python. Use `osmium` (libosmium C++ bindings via prebuilt wheel).

## The three stages

### Stage 1 — Extract with osmium

Subclass `osmium.SimpleHandler` and implement `node()` / `way()` / `relation()`. For each call, decide whether to keep the feature based on tag values.

```python
import osmium, json, sys
sys.stdout.reconfigure(line_buffering=True)   # force flush for live progress

class Extract(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.places = []
        self.roads = []
        self.node_count = 0
    def node(self, n):
        self.node_count += 1
        if self.node_count % 500_000 == 0:
            print(f'  {self.node_count:,} nodes ({time.time()-t0:.0f}s)', flush=True)
        t = dict(n.tags)
        place = t.get('place')
        if place in ('city','town','village','suburb','hamlet','locality','state'):
            self.places.append({
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [n.location.lon, n.location.lat]},
                'properties': {'name': t.get('name',''), 'place': place, 'population': t.get('population','')}
            })
    def way(self, w):
        t = dict(w.tags)
        hw = t.get('highway')
        if hw in ('motorway','trunk','primary','motorway_link','trunk_link'):
            coords = []
            for nd in w.nodes:
                if nd.location.valid():
                    coords.append([nd.lon, nd.lat])
            if len(coords) >= 2:
                self.roads.append({
                    'type': 'Feature',
                    'geometry': {'type': 'LineString', 'coordinates': coords},
                    'properties': {'name': t.get('name',''), 'highway': hw, 'ref': t.get('ref','')}
                })

h = Extract()
h.apply_file(r'D:\\path\\to\\australia-260404.osm.pbf')   # raw string for Windows paths
print(f'extracted {len(h.places):,} places, {len(h.roads):,} roads')

with open('out.geojson', 'w', encoding='utf-8') as f:
    json.dump({'type': 'FeatureCollection', 'features': self.places + self.roads}, f)
```

**Critical for large files**: `apply_file()` is **streaming** — osmium does NOT load the whole PBF into RAM. But it iterates in PBF native order (dense nodes → nodes → ways → relations), so you'll see a long quiet stretch of dense-node scanning before any ways start appearing. This is normal — don't add a timeout thinking the script is stuck.

**Empirical memory & wall-clock for a full Australia extract (2026-07-17, z0..z6, 9 source-layers, in-memory bucketing):**

| Phase | Wall time | Peak RSS | Notes |
|---|---|---|---|
| Dense-node scan (131M nodes) | ~5 min | 3.2 GB | Linear ~22 MB RSS per 1M nodes |
| Way stage (10.9M ways) | ~3 min | 6.2 GB | Sharp jump when way features flood in |
| Relation stage | < 30s | ~6.5 GB | Admin boundaries |
| Pass 1 total | ~8 min | 6.5 GB peak | 3.4M features → 74 non-empty tiles |
| Pass 2 (encode + write) | ~5 min | ~4 GB | First tile (z=0) is slowest; needs progress prints |
| Output PMTiles | — | — | 293 MB on disk |

**Memory cap gotcha**: A naive `if rss > 4_000: raise MemoryError` aborts pass 1 mid-way through the way stage (~6 GB needed). Use **8 GB minimum** for full-detail country extraction. On 32 GB systems you have headroom; on 16 GB systems, cap zoom range to z0..z5 or split the PBF geographically.

**Pass 2 silent-hang trap**: After pass 1 prints its summary, pass 2 begins encoding tiles. The first tile (z=0 x=0 y=0, containing the whole world) typically takes 30-60 seconds because all `places` features land in it. With no progress prints, the user sees the log stop and assumes the process hung — they kill it. Always add `print(f'  encoding tile {idx+1}/{N}', flush=True)` every 5 tiles or every 30 seconds, whichever fires first.

### Stage 2 — Bucket into Web Mercator tiles

For each feature, decide which Z/X/Y tiles it appears in. **Aggressively limit the zoom range** when generating yourself — z0..z6 covers a whole country, z0..z10 is enough for zoom-in details; z0..z15 produces a multi-GB PMTiles and is generally not feasible on a workstation.

```python
import math
TILE_SIZE = 4096  # MVT spec uses 4096 extents (not 256)

def lonlat_to_tile(lon, lat, z):
    n = 1 << z
    tx_f = (lon + 180.0) / 360.0 * n
    lat_rad = math.log(math.tan(math.pi/4 + lat * math.pi/180 / 2))
    ty_f = (1.0 - lat_rad / math.pi) / 2.0 * n
    tx, ty = int(tx_f), int(ty_f)
    return tx, ty, (tx_f - tx) * TILE_SIZE, (ty_f - ty) * TILE_SIZE
```

For points, place the feature in every tile from `minZoom..maxZoom` that contains it.
For lines, split the geometry per tile boundary — features that cross tiles must be clipped, not duplicated. (For demo purposes, putting the whole feature in the tile of its first point is usually acceptable; edges will look slightly off at tile boundaries but it's not visible at country zoom.)

### Stage 3 — Encode + wrap with pmtiles.Writer

```python
import mapbox_vector_tile
import pmtiles.writer as pw
import pmtiles.tile as pt

# Encode each (z,x,y) tile into MVT bytes.
# Use the LIST form (not the dict form) — see Pitfall 8 below.
def encode_tile(layer_features_by_name):
    nonempty = [(k, v) for k, v in layer_features_by_name.items() if v]
    if not nonempty:
        return None
    layer_list = [{"name": k, "features": v, "fields": {}} for k, v in nonempty]
    return mapbox_vector_tile.encode(layer_list)

# Wrap all tiles into a PMTiles v2 archive.
# tile_compression MUST match the actual tile bytes — see Pitfall 7 below.
header = {'spec_version': 2, 'tile_type': pt.TileType.MVT,
          'tile_compression': pt.Compression.NONE}
metadata = {
    'name': 'australia',
    'format': 'pbf',
    'bounds': [110.0, -45.0, 155.0, -10.0],
    'center': [133.0, -27.0, 3],
    'minzoom': 0, 'maxzoom': 6,
    'type': 'overlay',
    'description': 'Australia demo extracted from Geofabrik PBF',
    'generator': 'build_australia_pmtiles.py'
}

with open('australia.pmtiles', 'wb') as f:
    w = pw.Writer(f)
    for (z, x, y), layer_dict in tiles.items():
        mvt_bytes = encode_tile(layer_dict)
        if mvt_bytes is None:
            continue
        w.write_tile(pt.zxy_to_tileid(z, x, y), mvt_bytes)
    w.finalize(header, metadata)
```

**The `pmtiles` Python package is NOT read-only.** `pmtiles.writer.Writer` (and the `pmtiles.writer.write(path)` context manager) ships with the install. Don't waste time hunting for a Go binary that can write PMTiles.

**Why PMTiles v2 and not v3?**
- The Python writer only emits v2 (`spec_version: 2`).
- MapLibre 5.x reads both v2 and v3 transparently — same `pmtiles://` URL works.
- v2 differs from v3 mainly in directory entropy coding; for demo-sized archives it doesn't matter.

## Verification after writing

Three independent checks before declaring the archive loadable:

```python
import struct
with open('australia.pmtiles', 'rb') as f:
    head = f.read(16)
assert head[:7] == b'PMTiles', 'wrong magic'
# Note: the Python writer's spec_version dict value is 2, but the
# header byte is hardcoded to v3 by serialize_header(). Don't assert byte==2.
assert head[7] in (2, 3), f'expected spec v2 or v3, got {head[7]}'
print('magic + spec OK')
```

Then via Chrome MCP — load `index.html` with the new source, evaluate:
```js
const m = window.__map;
const feats = m.queryRenderedFeatures(undefined, { layers: ['src-australia-roads'] });
return { count: feats.length, sample: feats[0]?.properties };
```
`count > 0` proves the tiles decoded and the source-layer name matches what your Python writer emitted.

## Common pitfalls

1. **`osmium.apply_file()` blocked on dense nodes forever** — this is just the data format; PBF stores dense nodes first, then sparse nodes, then ways, then relations. Wait 5-10 min before suspecting a bug.

2. **`pyrosm` import fails on Windows** — `cykhash` needs MSVC. Switch to `osmium`.

3. **`mapbox_vector_tile.encode()` crashes on a feature with no `properties`** — ensure every feature has `properties={}` at minimum.

4. **`pmtiles.Writer.write_tile()` raises on out-of-order tileids** — the writer expects tileids in ascending order OR you accept `clustered=False`. For demo data either is fine.

5. **PMTiles file is enormous (multi-GB)** — you almost certainly over-generated zoom levels. Drop `maxzoom` from 14 → 6 for a country overview.

6. **Browser says "tile decode error" but no console error** — usually a `source-layer` name mismatch: your style says `"source-layer": "roads"` but the writer emitted a layer named differently. Run `m.getStyle()` in DevTools and compare to your Python layer keys.

7. **`tile_compression` header doesn't match actual tile bytes** (NEW 2026-07-17). The `pmtiles.Writer.finalize()` takes a `header` dict that includes `tile_compression`. If you set `pt.Compression.GZIP` but pass `mapbox_vector_tile.encode()`'s **raw** output (uncompressed protobuf), MapLibre will try to gunzip the bytes, get garbage, and emit silent "Failed to fetch" errors 18+ times in the console with no obvious cause. Two fixes — pick one:

   ```python
   # Option A: tell the truth (raw MVT, no compression)
   header = {'spec_version': 2, 'tile_type': pt.TileType.MVT,
             'tile_compression': pt.Compression.NONE}

   # Option B: actually gzip each tile (smaller file, more CPU)
   import gzip
   encoded = mapbox_vector_tile.encode(layer_list)
   encoded_gz = gzip.compress(encoded)
   header = {'spec_version': 2, 'tile_type': pt.TileType.MVT,
             'tile_compression': pt.Compression.GZIP}
   w.write_tile(tileid, encoded_gz)
   ```

   The MapLibre client honors this header strictly. Default to NONE for fastest encode, GZIP if you want smaller archives (~30% size reduction for point-heavy data).

8. **`mapbox_vector_tile.encode()` API ambiguity** (NEW 2026-07-17). The package accepts either a **list of layer dicts** OR a single dict — but the dict form has a confusing shortcut: it looks up `layers["name"]` and assumes that's the layer name, not a layer key. If you pass `{ "places": {...}, "roads": {...} }` (the obvious shape), it crashes with `KeyError: 'name'`. Use the list form, which is unambiguous:

   ```python
   # WRONG — looks up layers["name"], KeyError
   encoded = mapbox_vector_tile.encode({
       "places": {"features": [...], "fields": {}},
       "roads":  {"features": [...], "fields": {}},
   })

   # RIGHT — list of {"name", "features", "fields"} dicts
   encoded = mapbox_vector_tile.encode([
       {"name": "places", "features": [...], "fields": {}},
       {"name": "roads",  "features": [...], "fields": {}},
   ])
   ```

9. **`pmtiles.Writer.finalize()` header dict requirements** (NEW 2026-07-17). The header dict passed to `finalize()` MUST contain at least `spec_version`, `tile_type`, AND `tile_compression` — all enum values from `pmtiles.tile`. Forgetting any of them raises `KeyError` in `serialize_header()`. The writer sets most other fields (`root_offset`, `tile_data_offset`, etc.) itself; you only need to provide the three above plus whatever metadata you want. Note: `spec_version: 2` is what you write in the dict, but `serialize_header()` hardcodes the header byte to v3 — don't be confused by the mismatch.

10. **`osmium.apply_file()` WITHOUT `locations=True` drops way geometries** (NEW 2026-07-17). This is the single most common reason "my PBF extract has zero roads". By default osmium only stores locations for nodes that pass through `node()` (tagged nodes). A way's member nodes are stored as opaque refs — to read their coordinates you must pass `locations=True` to `apply_file()`. Without it, `nd.lon` and `nd.lat` raise an exception, your way loop silently produces nothing, and your "extract" contains only point features. Always:

    ```python
    h.apply_file(pbf_path, locations=True)   # CRUCIAL for way polygons + line geometries
    ```

    A second class of subtle bugs in this family:
    - **Closed way → polygon assumption**: if `coords[0] == coords[-1]` AND the layer makes sense as a polygon (buildings, water, landuse), wrap as `Polygon`; otherwise keep as `LineString`. Mixing these produces 0 rendered features (MapLibre silently drops `fill` layers with non-polygon source geometries).
    - **Out-of-bbox points mid-way**: don't drop OOB points then continue — that'll create nonsensical short segments. Either keep the segment (feature gets put in the first in-bbox point's tile, may look like it teleports) or split the geometry at the bbox boundary. For demo purposes, dropping the entire segment at the first OOB point is fine.
    - **Dense-node flood**: `node()` fires for every node in the file (~130M for Australia). Always early-return on `if not tags: return` BEFORE doing expensive tag lookup. Without this, your script spends minutes classifying untagged dense nodes that contribute nothing.

11. **Filter only what you actually need — don't under-filter** (NEW 2026-07-17, after explicit user correction). The temptation when extracting is to be conservative: "I'll just keep the major roads and cities". But OSM's taxonomy is rich and the user typically wants "as much detail as the PBF allows". For an Australia PBF:
    - "Cities only" filter → 21,000 places, no buildings, no roads → user sees a dot map
    - "Everything tagged" filter → **~150K places + 700K+ buildings + 1M+ roads** → user sees a real map

    Always err toward including more layers, then limit zoom range (e.g. z0..z10) to keep file size sane. A "complete but lower-zoom" PMTiles is much more useful than a "sparse but high-zoom" one. Recommended minimum layer set:
    - `places` (every node with `place=*`)
    - `pois` (every tagged node that isn't a place: highway=bus_stop, amenity=*, shop=*, tourism=*)
    - `roads` (every way with `highway=*`, including residential / service / path / footway)
    - `buildings` (every way with `building=*`)
    - `water` (waterway, water, natural=water)
    - `landuse` (landuse=*, natural=*, leisure=*)
    - `transit` (railway, aerialway)
    - `aeroway` (aeroway=* — airports, runways)
    - `infrastructure` (power, man_made, barrier, amenity as ways)

    For relations: `boundary=administrative` with admin_level 2..6 gives country/state/region outlines (without geometry assembly you'll only get names, not polygons — that's fine for demo).

12. **`pmtiles.Writer` does not deduplicate across tiles** (NEW 2026-07-17). When you bucket a single point into z0, z1, z2, ..., z10 (one per zoom level), the writer stores each as a separate tile entry. For a single Point feature, this means 11 duplicate entries in the PMTiles file. This is fine for tile counts (a city point appears at every zoom so MapLibre can render it at any zoom) but it means file size scales with `feature_count × zoom_levels`. For a country with 1M features × z0..z10 = 11M tile entries. Mitigate by capping zoom range aggressively (z0..z6 for country, z10..z15 for city zoom).

13. **Large extraction creates millions of in-memory tile buckets** (NEW 2026-07-17). `buckets: dict[(z,x,y)] -> dict[layer] -> list[features]` will balloon to gigabytes for a country-level PBF if you don't limit zoom range. z0..z6 with 150K features produces ~70 tiles and stays under 200 MB. z0..z14 produces 4M+ tiles and will OOM. **Limit zoom range first; add zooms only if you have memory headroom.**

14. **Process `apply_file` once and bucket in the same pass — don't double-pass** (NEW 2026-07-17). The natural-looking two-stage pipeline (1. extract everything to a 4 MB GeoJSON, 2. bucket GeoJSON into tiles) is fine for small datasets but for an 887 MB PBF producing 150K+ features it works. The faster path is to bucket **directly inside the osmium handlers** — call `lonlat_to_tile_xy()` for each feature and push into `buckets[(z,tx,ty)][layer]`. This way you only ever hold the per-tile feature lists in memory, not the whole extract. Saves 5-10 minutes on an Australia-sized PBF.

15. **Bucket must dispatch on `geometry.type` BEFORE unpacking coordinates** (NEW 2026-07-17). The `add_to_tiles(layer, feat)` helper picks the "representative lon/lat" for the feature by reading its first coordinate. The unpacking depth differs by geometry type:

    - `Point`: `lon, lat = coords` (coords is `[lon, lat]`)
    - `LineString`: `lon, lat = coords[0]` (coords is `[[lon,lat], ...]`)
    - `Polygon`: `lon, lat = coords[0][0]` (coords is `[[[lon,lat], ...], ...]` — outer list of rings)

    If you write a single branch like `lon, lat = coords[0]` for all three types, **a Polygon will crash with `ValueError: too many values to unpack`** partway through the way() handler loop, after you've already accumulated 90%+ of features in memory. You lose all that work because the process exits. Fix: dispatch on `gtype` first. Better fix: wrap the unpack in try/except and `return` on failure — a single bad geometry should never abort a 30-minute extraction. The 2026-07-17 Australia run hit this exact bug at 130M nodes / 1388K features / 3.2 GB RSS, losing all accumulated work.

    ```python
    def add_to_tiles(layer_name, feat):
        geom = feat['geometry']
        gtype = geom['type']
        coords = geom['coordinates']
        try:
            if gtype == 'Point':
                lon, lat = coords
            elif gtype == 'LineString':
                lon, lat = coords[0]
            elif gtype == 'Polygon':
                lon, lat = coords[0][0]
        except (ValueError, TypeError) as e:
            print(f'WARN: skipping bad geom gtype={gtype} layer={layer_name} err={e}', flush=True)
            return
        if not in_bbox(lon, lat):
            return
        for z in range(MIN_ZOOM, MAX_ZOOM + 1):
            tx, ty, _, _ = lonlat_to_tile_xy(lon, lat, z)
            tiles[(z, tx, ty)][layer_name].append(feat)
    ```

16. **GeoJSON LineString coords wrapping bug — silent crash after 30 min of work** (NEW 2026-07-17). When constructing the geometry dict for a way in your `way()` handler, the wrapping depth matters:

    ```python
    # GeoJSON LineString: coords is [pos, pos, ...] — ONE level of lists
    geom_coords = coords   # ← correct (coords is already a list of [lon,lat])

    # GeoJSON Polygon: coords is [ring, ring, ...] — TWO levels of lists
    geom_coords = [coords] # ← wrap once: outer list is rings, inner is points
    ```

    **WRONG**: `geom_coords = [coords]` for both — this wraps LineString into `[[pos, pos, ...]]` (3 levels of nesting) which crashes downstream with `ValueError: too many values to unpack` when the bucketing helper tries `lon, lat = coords[0]`. This bug **survives the entire node-scanning phase** (no ways yet) and only surfaces when you hit your first way feature, ~5 minutes in.

17. **Memory curve for in-memory bucket dict on large PBF** (NEW 2026-07-17). Measured on the 887 MB Australia PBF (Geofabrik 2026-04-05), z=0..z6, all-tagged-features filter:

    | Stage | RSS |
    |---|---|
    | 5M nodes scanned | 245 MB |
    | 40M nodes | 1.0 GB |
    | 80M nodes | 1.9 GB |
    | 130M nodes (end of node phase) | 3.2 GB |
    | 1388K features accumulated | 3.2 GB |
    | Way stage peak | 6.2 GB |

    **Linear slope: ~22 MB RSS per 1M nodes scanned**, regardless of features added (the dict overhead dominates the feature storage itself because the same feature dict is referenced from 7 tile-bucket lists). Per-feature overhead ≈ 0 because features are stored once and shared across tile-bucket references (Python dict references, not copies).

    **Budget**: 4 GB available RSS → comfortable ceiling is ~150M nodes before OOM risk on a 32 GB machine with 4 GB headroom. For larger datasets (Planet PBF = 100 GB), this approach does not work — switch to streaming PBF encoder or use tippecanoe on Linux.

18. **When the user says "pbf有多细致我就要多细致" — preserve everything** (NEW 2026-07-17, after explicit user correction). The first Australia run shipped a "21K places only" PMTiles (5.3 MB) and the user pushed back: "我看澳大利亚的只看到一堆兴趣点，我要的全量的数据，pbf有多细致，我就要多细致". The correct response is NOT to compromise by picking a "moderate" subset — it's to ship the full-detail PMTiles (1.4M+ features across 9 source-layers, ~150-300 MB file). The user-supplied PBF is the source of truth for "how much detail"; your job is to convert faithfully, not to filter for compactness. The trade-off is **zoom range and memory**, not **layer coverage**:

    | Wrong trade-off | Right trade-off |
    |---|---|
    | "Drop buildings/roads to keep file small" | "Include all layers, cap zoom range to z0..z6" |
    | "Keep only major roads" | "Keep every highway value (residential, service, footway), cap zoom range" |
    | "Skip landuse/aeroway — too much detail" | "Include them, cap zoom range" |
    | "Filter to ~30K features for compactness" | "Keep all 1.4M features, the file is large but PMTiles handles it via Range" |

    **When in doubt, ship the full extract.** If memory becomes the constraint, reduce zoom range (the right knob), not layer coverage (the wrong knob).

## Reference templates

- `templates/extract-osm-pbf.py` — copy-paste starting point for Stage 1 (minimal filter, only places + major roads, ~5 MB output)
- `templates/extract-osm-pbf-full.py` — full-detail variant for "pbf有多细致我就要多细致" requests, 9 source-layers, ~293 MB output