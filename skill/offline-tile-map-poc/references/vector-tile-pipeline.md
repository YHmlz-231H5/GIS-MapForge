# Vector tile pipeline (download → slice → archive)

Canonical flow for offline vector maps. UI labels may say「生成矢量瓦片」; the work is **tiling + packaging**.

```
Region bbox
    │
    ├─► [A] Download OSM extract ──► .osm / .osm.pbf
    │         Overpass (CN-friendly) | Geofabrik | OSM API | BBBike
    │
    └─► [B] Planetiler (Java) ──► vector tiles ──► archive
              OpenMapTiles profile              .pmtiles | .mbtiles
```

## Terminology

| Term | Meaning |
|------|---------|
| **Download** | Fetch raw OSM geography (XML/PBF), not map pictures |
| **Tiling / 切片** | Cut features into z/x/y vector tiles (MVT) |
| **Archive / 打包** | Store tiles in PMTiles or MBTiles |
| **Raster download** | Separate path: fetch PNG/JPEG XYZ tiles (see `raster-xyz-download.md`) |

## Step A — where to get OSM

| Scenario | Source | Notes |
|----------|--------|-------|
| Country / province extract | **Geofabrik** | Fast CDN, `.osm.pbf` |
| Arbitrary bbox (esp. CN) | **Overpass mirrors** | Tile the bbox, merge XML → `.osm` |
| Tiny bbox | OSM Main API `/api/0.6/map` | Hard size limits |
| Custom clip of large PBF | Osmium / BBBike | Offline clip |

Prefer **`.osm.pbf`** for Planetiler. If you only have `.osm` (XML), convert first (`@osmix/pbf` or osmium).

## Step B — Planetiler

```bash
java -Xmx6g -jar planetiler.jar \
  --osm-path=region.osm.pbf \
  --bbox=W,S,E,N \
  --output=region.pmtiles \   # or .mbtiles — format from extension
  --download=false \
  --download_dir=data/sources \
  --force
```

- **Standard defaults**: maxzoom=14, all OpenMapTiles layers, no `--exclude-layers`
- **Custom**: `--exclude-layers=...`, maxzoom up to **16**, profile flags — see `planetiler-convert-options.md`
- Aux sources (water polygons, natural earth, lake centerlines) must exist under `download_dir` when `--download=false`

## PMTiles vs MBTiles (vector)

Same MVT content; different container. Choose by tooling (Range HTTP → PMTiles; classic GIS → MBTiles).

## Two UI steps (recommended)

1. Download OSM only  
2. 「生成矢量瓦片」→ pick archive format + standard/custom params  

Do not chain download+convert in one click if you need clear failure isolation.

## Related

- `pbf-data-sources.md` — download sources detail  
- `planetiler-windows.md` — Windows/Java  
- `planetiler-convert-options.md` — CLI truth table  
- `raster-xyz-download.md` — raster (image) tiles path  
- `planetiler-output-validation.md` — verify output  
