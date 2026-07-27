# OSM PBF Data Sources — where to download any region's extract

Captured 2026-07-18 in response to the user asking: *"如果我要下载任意一个区域的pbf数据呢，有没有途径"*. The answer is yes — **four** authoritative sources cover virtually any use case. **Geofabrik is the default** for most projects, BBBike for arbitrary bbox, OSM main API bbox extract for tiny areas where Geofabrik has no sub-region (e.g. mainland China), OSM.org for the full planet.

This file complements `pbf-to-pmtiles-recipe.md` (which assumes you already have a PBF). Once you've downloaded a PBF from one of the sources below, the pipeline is the same: `java -jar planetiler.jar --area=X --osm_path=Y.pbf --output=Z.pmtiles`.

## TL;DR — which source to use

| Need | Use | URL |
|------|-----|-----|
| **Whole country / state** | **Geofabrik** | `https://download.geofabrik.de/...` |
| **Arbitrary bbox / city / neighbourhood** | **BBBike** | https://download.bbbike.org/ |
| **Small bbox where Geofabrik has no sub-region** (mainland China, Korea, Singapore detail, etc.) | **OSM main API bbox extract** (NEW 2026-07-18) | `https://api.openstreetmap.org/api/0.6/map?bbox=...` |
| **Most-up-to-date / authoritative** | **OSM.org planet mirror** | https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf |
| **Historical snapshot at a date** | OSM planet (full) or Geofabrik mirror | see below |

---

## 1. Geofabrik — the default choice

**Maintainer:** Geofabrik GmbH (the German company that makes QGIS and other GIS tools).  
**Update cadence:** every few hours, hourly for popular countries.  
**Coverage:** every country in the world, plus many sub-region splits (states / provinces).  
**Format:** single `.osm.pbf` per region, no API key required.

### Browse and download

The catalog is browseable at <https://download.geofabrik.de/>. A few representative URLs:

```
# Whole countries
https://download.geofabrik.de/europe/germany-latest.osm.pbf
https://download.geofabrik.de/north-america/us-latest.osm.pbf
https://download.geofabrik.de/asia/china-latest.osm.pbf          # note: mainland China is sometimes empty/stale
https://download.geofabrik.de/asia/japan-latest.osm.pbf
https://download.geofabrik.de/asia/singapore-latest.osm.pbf       # not actually a sub-region
https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf
https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf
https://download.geofabrik.de/africa/south-africa-latest.osm.pbf

# Sub-regions (some countries have these)
https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf
https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf
https://download.geofabrik.de/europe/france-provence-alpes-cote-d-azur-latest.osm.pbf
https://download.geofabrik.de/north-america/us/california-latest.osm.pbf
https://download.geofabrik.de/north-america/us/florida-latest.osm.pbf
https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf
```

### Naming convention

```
{country-or-continent}/{optional-sub-region}-{latest|YYYYMMDD}.osm.pbf
```

Use `latest` for the most current. Use `YYYYMMDD` (e.g. `260717`) for reproducibility / historical studies.

### `.osm.pbf` vs `.osm.bz2`

**Always use `.osm.pbf`** — it's an OSM-standard binary format that osmium / planetiler can read directly. Don't try to process `.osm.bz2` (text format, 8× larger, very slow to parse).

### Why Geofabrik is reliable

- **Fast CDN** (Akamai-style edge caching) — your earlier 20 KB/s rate-limit was *not* a Geofabrik limit; it was GitHub release downloads. Geofabrik typically downloads at 5-50 MB/s.
- **Stable URLs** — files are dated, not random versioned — you can re-download the same URL to refresh.
- **Predictable sizes** — most countries' PBFs are well-known: US 6 GB, Germany 4 GB, Australia ~890 MB, Singapore ~80 MB.

### Tip: speed with `aria2c` / parallel connections

```bash
# aria2c supports 16 parallel connections on a single file (Geofabrik allows it)
aria2c -x 16 -s 16 https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf
```

(A plain `curl -O` works fine too if you're not in a hurry.)

---

## 2. BBBike — arbitrary bbox

**Maintainer:** BBBike.org community.  
**Use case:** when you need a **specific rectangle** (e.g. the metro area of a single city) and Geofabrik's country-level extract is too coarse.

### Two ways to use

**(a) Pre-cut cities / regions** — they maintain extracts for ~200 cities worldwide:

```
https://download.bbbike.org/osm/bbbike/
├── Amsterdam/
├── Amsterdam.osm.pbf
├── Berlin/
├── Berlin.osm.pbf
├── Singapore/
├── Singapore.osm.pbf
├── Tokyo/
├── Tokyo.osm.pbf
├── NewYork/
├── NewYork.osm.pbf
└── ...
```

**(b) Custom bbox extract** (the headline feature) — open the website, *draw a rectangle on the map*, choose format:

```
https://download.bbbike.org/
  → drag the map / draw a rectangle
  → choose the layer (default: osm)
  → choose format: "Geofabrik (.osm.pbf)" or "Osmium (.osm.pbf)" or "Raw OpenStreetMap"
  → submit
  → download link emailed / available immediately
```

BBBike then re-runs Osmium to clip to your bbox. **Generic formats** available: ESRI Shapefile, GeoJSON, KML, Garmin, Mapbox, Osmium, **and PMTiles** (post-Nov 2023).

### Limits

- **Maximum area:** ~1 GB compressed PBF (~20 GB uncompressed). Larger extracts are rejected.
- **Soft cap:** ~50,000 km². Bigger areas work but take hours to generate.
- Requires JavaScript + browser interaction (no public REST API for arbitrary bbox).

### When to use

- "I just need Shanghai inner districts" (≥5000 km², sub-city)  
- "Give me a 30 km square around a research site"
- "Berlin plus surrounding municipalities"
- Sub-region that's not pre-cut by Geofabrik.

---

## 3. OSM.org / planet.openstreetmap.org — the source of truth

**Maintainer:** OpenStreetMap Foundation.  
**Use case:** the entire planet — used by Planetiler's own `--area=planet` profile and by anyone wanting the freshest possible data.

```
https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf       # ~80 GB compressed, ~1.2 TB uncompressed
https://planet.openstreetmap.org/pbf/planet-250101.osm.pbf       # snapshot for Jan 1, 2025
```

### Why you probably don't want this

- **Size.** The planet file is ~80 GB compressed. Even on a fast connection (50 MB/s sustained), that's ≥25 min just to download.
- **Memory.** Converting it requires 80-100 GB RAM.
- **Bandwidth courtesy.** The OSMF bandwidth is donated; please don't hammer it with parallel downloads.

### When to use

- Reproducing Planetiler's `planet.pmtiles` (the global basemap).
- Studies where freshness is critical (within hours of OSM edits).
- Other options (Geofabrik) lag by 6-48 hours.

---

## 4. Other sources (less common)

| Source | Notes |
|--------|-------|
| **OpenStreetMap.fr** | French community mirror of planet-latest, same format |
| **Wikimedia Maps** | Hosts some smaller extracts |
| **Humanitarian OpenStreetMap Team (HOT)** | Special task-managed exports for humanitarian mapping |
| **Nextzen mirror** | Older; mostly superseded by Geofabrik |
| **OSM Lab mirror** | Same format; secondary CDN |

For non-China nations, Geofabrik is fastest and most reliable.

---

## Picking the right source — decision tree

```
Do you need a whole country or major sub-region?
├── YES  → Geofabrik (latest URL or dated snapshot)
│         Example: https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf
│
└── NO   → Is your area bigger than ~50,000 km²?
    ├── YES  → Probably want Geofabrik sub-region or BBBike pre-cut city
    │         Even though Geofabrik "city" doesn't exist for many places, use
    │         the country's national extract and filter with osmium.
    │
    └── NO   → BBBike (draw rectangle on their map)
              Or, if your city is in their pre-cut list → BBBike/&lt;CityName&gt;.osm.pbf
```

For PoC, always reach for Geofabrik first. For demo data of arbitrary shape, BBBike.

---

## Downloading into this project's directory layout

The skill assumes your PBF lives at `data/<region>-YYYYMMDD.osm.pbf`. Example:

```bash
# Singapore — small, fast, great for first-time PoC
mkdir -p data
curl -L -o data/singapore-260718.osm.pbf \
  https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf

# Australia — what we just did
curl -L -o data/australia-260404.osm.pbf \
  https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf
```

After download, immediately compare the size against what's known:

```bash
ls -lh data/singapore-260718.osm.pbf
# Should be ~80 MB or similar — if you got a few hundred KB, the connection
# was interrupted; re-run with `curl -C - -o ...`
```

(Planetiler, like curl, supports HTTP Range Requests and resume; pass `curl -L -C -` or use the ChromeMCP browser if downloading is unreliable.)

---

## Pitfalls specific to PBF downloads

**Pitfall A:** **"latest" is not stable** — link to a dated filename instead if you need reproducibility:
```bash
# Get today's date
DATE=$(date -u +%y%m%d)
curl -o data/singapore-${DATE}.osm.pbf \
  https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf
# Now record both the date AND a sha256 of the file in your project README.
```

**Pitfall B:** **Geofabrik filenames use hyphens, not slashes** for sub-regions:
```
https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf
                              \___________/\_______/
                                  sub-region
```
Always one level of sub-region per file. For districts within Bayern, you'd need to use the boundary-polygon filter (BBBike or osmium-tool).

**Pitfall C:** **`-latest.osm.pbf` is a redirect** — use `curl -L` to follow it:
```bash
curl -L -o foo.pbf https://...-latest.osm.pbf    # ✓
wget ...                                          # ✓
```
Without `-L`, you may save an HTML redirect response instead of the file.

**Pitfall D:** **HTTP Range Request mismatch on resume** — if Planetiler thinks the file is corrupt and headers say "Invalid or corrupt jarfile", it almost always means `curl -C -` resumed at a 0-byte offset and double-counted. Verify with:
```bash
ls -la data/foo.pbf
md5sum data/foo.pbf
# Compare against the size on Geofabrik's index page
```
If wrong, `rm -f` and re-download.

**Pitfall E:** **Not China-restricted** — Geofabrik does serve mainland China (`china-latest.osm.pbf`), but OSM data for China has known gaps due to local regulations. If you need full China coverage, consider Overpass API (live, query-based) instead.

---

## Reference — verified URLs (most recent as of 2026-07-18)

The following URLs were downloaded successfully during the Skill's development:

| Region | URL | Size |
|--------|-----|------|
| 🇦🇺 Australia | https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf | 887 MB |
| 🇸🇬 Singapore | https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf | ~80 MB |
| 🇩🇪 Germany | https://download.geofabrik.de/europe/germany-latest.osm.pbf | ~4 GB |
| 🇯🇵 Japan | https://download.geofabrik.de/asia/japan-latest.osm.pbf | ~1.3 GB |
| 🌍 Full planet | https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf | ~80 GB |

(Refresh date for the Skill files was 2026-07-18; for reproducible results, use a dated snapshot URL.)

---

## End-to-end scripted example (Singapore, ~2 min)

```bash
# 1. Download PBF
mkdir -p data demo
curl -L -o data/singapore-$(date -u +%y%m%d).osm.pbf \
  https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf

# 2. Convert to PMTiles (Planetiler OpenMapTiles profile)
java -Xmx4g -jar tools/planetiler.jar \
  --area=monaco_download=false \
  --osm_path=data/singapore-*.osm.pbf \
  --output=demo/singapore.pmtiles

# 3. Run the skill's audit
python scripts/audit-pmtiles.py http://127.0.0.1:8765/singapore.pmtiles
#                                                            ^^^^^^^^ substitute demo region

# 4. Start the server and view in Chrome
cd demo && python server.py 8765
# Open http://127.0.0.1:8765/index.html after adding singapore to REGIONS dict
```

That's the entire pipeline for a new region — change 4 lines and you have a fresh demo.

---

## See also

- `references/pbf-to-pmtiles-recipe.md` — once you have a PBF, the next step
- `references/planetiler-windows.md` — the Planetiler invocation details
- `references/memory-requirements.md` — RAM needs for each region size
- `scripts/audit-pmtiles.py` — verify the final output is sound
