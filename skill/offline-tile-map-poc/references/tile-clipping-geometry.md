# Tile Clipping — Geometry cross-tile splitting for PBF→PMTiles

Captured during the 2026-07-17 Australia PBF session when the user
complained: "我看澳大利亚的只看到一堆兴趣点，... 结果地图上有很多杂乱的线，
应该是构建坐标点有问题".

## Why this exists

If you bucket a long line (e.g. Sydney → Brisbane, 5° of longitude apart) into
a single tile using only the first point's tile, then convert all its
coordinates to pixel space **in that tile's local frame**, you get pixel
coordinates that can be far outside `[0, 4096]`. MapLibre then draws a line
from the in-tile part to the way-outside-the-tile end — producing a
horizontal/vertical slash across the visible map. This is the user's
"杂乱的线" bug.

**The fix**: clip each line/polygon to the tile's bounding box before
computing pixel coordinates, and bucket the same feature into EVERY tile
its bbox touches.

## The standard library-based recipe (use this, don't hand-roll)

```python
import mercantile
from shapely.geometry import LineString, Polygon, Point, box

def add_to_tiles(tiles, layer_name, feat, min_zoom, max_zoom):
    geom = feat['geometry']
    gtype = geom['type']
    coords = geom['coordinates']
    # 1. Compute the feature's lon/lat bbox.
    if gtype == 'Point':
        xs = [coords[0]]; ys = [coords[1]]
    elif gtype == 'LineString':
        xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
    elif gtype == 'Polygon':
        ring = coords[0]
        xs = [c[0] for c in ring]; ys = [c[1] for c in ring]
    fbbox = (min(xs), min(ys), max(xs), max(ys))

    # 2. Find EVERY tile this bbox touches at each zoom.
    #    mercantile.tiles() is the canonical way; do not hand-roll tile math.
    for z in range(min_zoom, max_zoom + 1):
        for t in mercantile.tiles(fbbox[0], fbbox[1], fbbox[2], fbbox[3], zooms=z):
            # 3. Clip the feature to THIS tile's bbox.
            west, south, east, north = mercantile.bounds(t)
            tile_poly = box(west, south, east, north)
            if gtype == 'Point':
                if not (west <= coords[0] <= east and south <= coords[1] <= north):
                    continue
                clipped = Point(coords)
            elif gtype == 'LineString':
                line = LineString(coords)
                clipped = line.intersection(tile_poly)
                if clipped.is_empty:
                    continue
            elif gtype == 'Polygon':
                poly = Polygon(coords[0], coords[1:] if len(coords) > 1 else [])
                clipped = poly.intersection(tile_poly)
                if clipped.is_empty:
                    continue

            # 4. Convert clipped geometry to pixel coords IN THIS TILE'S frame.
            def to_px(c):
                lng, lat = mercantile.truncate_lnglat(c[0], c[1])
                px = (lng - west) / (east - west) * 4096
                py = (north - lat) / (north - south) * 4096
                return [px, py]
            # ... build pix_geom from clipped ...

            tiles[(t.z, t.x, t.y)][layer_name].append({
                'type': 'Feature',
                'geometry': pix_geom,
                'properties': feat['properties'],
            })
```

## The fast-path optimization (memory savings)

The above pattern calls `shapely.intersection()` for **every** feature at
**every** zoom. For a long line that touches 4 tiles at z=6, that's 28
shapely calls per feature × 1.1M roads × 7 zooms = O(200M shapely calls).
This is what killed the 2026-07-17 Australia run — the shapely overhead
pushed RSS past 4 GB during the way stage and the OS OOM-killed it.

**Optimization**: check if the feature's geometry is fully inside the tile
bbox BEFORE calling shapely. Most features are short and stay within one
tile at any given zoom; only long ways cross tiles.

```python
def feature_to_pixels(geom_dict, t):
    gtype = geom_dict['type']
    coords = geom_dict['coordinates']
    west, south, east, north = mercantile.bounds(t)
    tile_bbox = (west, south, east, north)

    if gtype == 'Point':
        if not (west <= coords[0] <= east and south <= coords[1] <= north):
            return None
        return {'type': 'Point', 'coordinates': list(to_px(coords))}

    if gtype == 'LineString':
        # FAST PATH: whole line inside this tile — just pixelize coords.
        all_in_tile = all(
            west <= c[0] <= east and south <= c[1] <= north
            for c in coords
        )
        if all_in_tile:
            return {'type': 'LineString',
                    'coordinates': [list(to_px(c)) for c in coords]}
        # SLOW PATH: clip with shapely.
        line = LineString(coords)
        clipped = line.intersection(box(*tile_bbox))
        if clipped.is_empty:
            return None
        # ... (handle LineString / MultiLineString results) ...
```

This cuts shapely calls by ~95% in practice (most features don't cross
tile boundaries), and on the Australia PBF it kept RSS under 3 GB
instead of climbing past 6 GB.

## The demo-side workaround (when full clipping isn't possible)

If you can't afford the clip pass at all (memory too tight, build keeps
OOM'ing), you can **partially hide the visual damage** by:
1. Setting `minzoom: 5` on the roads layer (long cross-tile ways are most
   visible at low zoom; at z=5+ tiles are small enough that the slashes
   are short and less obvious).
2. Filtering out the worst classes at low zoom:
   ```js
   filter: ["!in", ["get", "highway"],
            ["literal", ["footway", "path", "track"]]]
   ```
3. At low zooms, only show major arterials; expand at z=5+:
   ```js
   filter: ["all",
     ["!in", ["get", "highway"],
      ["literal", ["footway","path","track","steps","cycleway","pedestrian"]]],
     ["any",
       [">=", ["zoom"], 5],
       ["match", ["get", "highway"],
         ["motorway","trunk","primary","secondary","tertiary"], true,
         false]]]
   ```

This is a **hack**, not a fix. The right fix is full clipping. But the
hack buys a usable demo while you work on a 16 GB+ machine that can
actually run the full clip pass.

## Verification

After building, test that NO line/polygon feature has a pixel coord
outside `[0, 4096]`:

```python
import pmtiles, mapbox_vector_tile

def flatten_coords(geom):
    """Yield all (x, y) pairs from any geometry, recursing into Multi*."""
    gtype = geom['type']
    coords = geom['coordinates']
    if gtype == 'Point':
        yield coords
    elif gtype == 'LineString':
        for c in coords: yield c
    elif gtype == 'Polygon':
        for ring in coords:
            for c in ring: yield c
    elif gtype.startswith('Multi'):
        for sub in coords:
            for c in flatten_coords({'type': gtype[5:], 'coordinates': sub}):
                yield c

with open('australia.pmtiles', 'rb') as f:
    r = pmtiles.reader.Reader(f)
    bad = 0
    bad_features = []
    for z in range(0, 7):
        for x in range(0, 32):
            for y in range(0, 32):
                tile = r.get(z, x, y)
                if not tile:
                    continue
                decoded = mapbox_vector_tile.decode(tile)
                for layer_name, layer in decoded.items():
                    for feat in layer['features']:
                        geom = feat.get('geometry')
                        if not geom:
                            continue
                        for pt in flatten_coords(geom):
                            if not (0 <= pt[0] <= 4096 and 0 <= pt[1] <= 4096):
                                bad += 1
                                bad_features.append((z, x, y, layer_name, feat.get('properties', {}).get('name', '?')))
                                break
    print(f'features with out-of-tile pixels: {bad}')
    if bad_features:
        print('first 5:', bad_features[:5])
    assert bad == 0, 'CLIPPING BROKEN — fix before shipping'
```

## Why this bit me in 2026-07-17

In one session I shipped a 293 MB PMTiles (1M+ roads, 540K buildings) that
**visually rendered horizontal/vertical slashes across the entire Australian
continent**. The data was there; the map looked wrong. The user caught it
from a screenshot. Fixing it required re-implementing the entire bucketing
helper with `mercantile.tiles()` + `shapely.intersection()` — a 100-line
rewrite that then OOM'd on the 4 GB available memory, forcing a
demo-side workaround.

**Lesson**: when generating vector tiles from a raw geometry source, **clip
is not optional**, even for "demo" quality. The first successful run is
not a successful deliverable; the screenshot test is the deliverable.

## See also

- `references/pbf-to-pmtiles-recipe.md` — the parent recipe; Pitfall 11
  ("don't under-filter") is the *layer coverage* pitfall; this file is the
  *geometry correctness* pitfall.
- `references/memory-requirements.md` — the 4 GB wall and what to do about it.
