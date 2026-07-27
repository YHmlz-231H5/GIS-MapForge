# Raster XYZ download — image tiles for a bbox

Separate from OSM→Planetiler. Here you download **already-rendered** PNG/JPEG/WebP tiles from public XYZ endpoints, then optionally pack them.

```
bbox + zoom range + URL template
        │
        ▼
   fetch {z}/{x}/{y}  (Web Mercator / slippy map)
        │
        ├─► directory  z/x/y.png
        ├─► MBTiles    (SQLite; classic for raster)
        └─► PMTiles    (v3 supports raster tileType PNG/JPEG/WebP/AVIF)
```

## Slippy math

```
x = floor((lon + 180) / 360 * 2^z)
y = floor((1 - ln(tan(lat)+sec(lat))/π) / 2 * 2^z)
```

MBTiles `tile_row` is often **TMS-flipped**: `(2^z - 1) - y`.

## Containers

| Format | Raster support | Notes |
|--------|----------------|-------|
| **Directory** | Yes | Simplest; serve with any static server |
| **MBTiles** | **Yes (native use-case)** | `tiles` + `metadata` tables; widely supported offline |
| **PMTiles** | **Yes (tileType ≠ MVT)** | Great for HTTP Range; JS `pmtiles` package is mainly a **reader** — packing often via `go-pmtiles convert` from a tile directory |

Vector Planetiler output is MVT inside PMTiles/MBTiles. Raster archives store image bytes instead.

## Implementation checklist

1. Plan tile list for each z in `[minzoom, maxzoom]` covering bbox  
2. Parallel fetch with polite concurrency (e.g. 4–8) + User-Agent + retries  
3. Respect provider **ToS / rate limits** (OSMFtile usage policy, Esri attribution, etc.)  
4. Write directory tree; optionally pack to MBTiles (better-sqlite3) or PMTiles (external convert)  
5. Record attribution in metadata  

## URL template quirks

- Standard: `.../{z}/{x}/{y}.png`  
- ArcGIS often: `.../tile/{z}/{y}/{x}` (y before x) — still fine if placeholders match  
- Subdomains: `{s}` → a|b|c (cycle)

## Open / free-ish XYZ sources (no API key)

See app catalog `src/shared/raster-sources.ts` and list below. Always keep attribution.

| Id | Type | Template (pattern) | Notes |
|----|------|--------------------|-------|
| osm | streets | `tile.openstreetmap.org/{z}/{x}/{y}.png` | Strict usage policy — bulk download discouraged |
| osm-de | streets | `tile.openstreetmap.de/...` | Mirror |
| osm-fr | streets | `tile.openstreetmap.fr/osmfr/...` | FR style |
| hot | streets | `tile-{s}.openstreetmap.fr/hot/...` | Humanitarian |
| opentopomap | topo | `tile.opentopomap.org/{z}/{x}/{y}.png` | Terrain |
| cyclosm | bicycle | `a.tile-cyclosm.openstreetmap.fr/cyclosm/...` | Cycling |
| carto-light | streets | `basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png` | CartoCDN |
| carto-dark | streets | `basemaps.cartocdn.com/dark_all/...` | |
| carto-voyager | streets | `basemaps.cartocdn.com/rastertiles/voyager/...` | |
| stamen-toner | streets | via Stadia Hosting — may need key | Prefer Carto |
| esri-imagery | imagery | ArcGIS World_Imagery `tile/{z}/{y}/{x}` | Attribution required |
| esri-topo | topo | World_Topo_Map | |
| esri-street | streets | World_Street_Map | |
| wikimedia | streets | `maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png` | Rate-limited |
| openstreetmap-humanitarian | — | same as hot | |

Commercial (Google / 高德 / 腾讯) tiles are **not** “open”; omit from open-source catalogs or label clearly as ToS-restricted.

## Size warning

Tile count ≈ O(4^z). For a city bbox, z0–z14 is often fine; z16+ explodes. Always show estimated tile count before submit.

## Related

- `vector-tile-pipeline.md` — OSM→vector path  
- App: `raster-download-xyz` task + `raster-xyz.worker.mjs`  
