# Planetiler on Windows — the recommended path for OSM PBF → PMTiles

Captured 2026-07-17 after the user explicitly said *"Planetiler如果能把pbf转成pmtile，就使用这个"* and *"别用python了，换更高效的语言"*. Planetiler is the right tool: it's Protomaps' official PBF→PMTiles generator, written in Java with a disk-spill architecture, has built-in tile clipping (no cross-tile slashes), and runs cross-platform with a single 88 MB fat-jar.

This file is the **operational recipe** for the tool. The conceptual reasoning — why Planetiler, what pitfalls it avoids vs. pure-Python, etc. — lives in the parent skill's `SKILL.md` (search for "Planetiler" and "Pitfall 13" / "Pitfall 14").

## Quick reference — the working command

```bash
# Java 21 was already installed at C:\Program Files (x86)\jdk\bin\java.exe
# in the 2026-07-17 session. Try this first; only download a JDK if missing.
JAVA="/c/Program Files (x86)/jdk/bin/java.exe"
PMT_JAR="D:/ZmWorkSpace/Explore Dev/MapSolution/tools/planetiler.jar"
PBF="D:/ZmWorkSpace/Explore Dev/MapSolution/data/australia-260404.osm.pbf"
OUT="D:/ZmWorkSpace/Explore Dev/MapSolution/demo/australia.pmtiles"

"$JAVA" -Xmx6g -jar "$PMT_JAR" \
    --area=Australia \
    --download=false \
    --osm_path="$PBF" \
    --output="$OUT"
```

This produces a fully clipped, multi-layer PMTiles with `roads`, `buildings`, `water`, `landuse`, `places`, `pois`, `transit`, `aeroway`, `boundaries` — all the layers the existing `demo/index.html` style expects. No clipping code needed on your end.

### Gotcha 0b (NEW 2026-07-21): `--osm-path` MUST be `.osm.pbf`, not `.osm` XML

Planetiler `OsmInputFile` reads the OSM **PBF** wire format only. Passing Overpass/merged XML
(`.osm`) fails immediately with:

```
IllegalArgumentException: Header longer than 64 KiB
  at OsmInputFile.readBlobHeader
```

In `app-map-downloader`, convert first with pure-JS `@osmix/pbf` (sort nodes/ways/relations
by ascending id — unsorted IDs fail pass1 with `Nodes must be sorted ascending by ID`).
Do **not** document "Planetiler accepts XML".

## Gotcha 0: Check the environment BEFORE downloading anything (NEW 2026-07-17)

The 2026-07-17 session wasted ~1 hour downloading 88 MB of Planetiler because the agent didn't first check what was already on the machine. Before downloading anything:

```bash
# 1. Check Java (needed for Planetiler, but `which` lies on msys git!)
ls "/c/Program Files (x86)/jdk/bin/java.exe" 2>/dev/null && echo "Java at C:\Program Files (x86)\jdk"
ls "/c/Program Files/Java/jdk-"*/bin/java.exe 2>/dev/null
"/c/Program Files (x86)/jdk/bin/java.exe" -version 2>&1

# 2. Check memory available (OS OOM-killer will kill your build otherwise)
python -c "import psutil; m=psutil.virtual_memory(); print(f'avail={m.available/1024**3:.1f} GB used={m.percent}%')"

# 3. Find what's eating memory (often hidden GUI apps)
python -c "
import psutil
for p in sorted(psutil.process_iter(['name','memory_info']), key=lambda x: -x.info['memory_info'].rss)[:10]:
    print(f'{p.info[\"memory_info\"].rss/1024**2:7.0f} MB  {p.info[\"name\"]}')"
```

**Hard-won discoveries from 2026-07-17:**

1. **Java 21 was pre-installed at `C:\Program Files (x86)\jdk\bin\java.exe`** but `which java` and `where java` from msys git BOTH returned nothing. The first check `ls "/c/Program Files (x86)/jdk/bin/java.exe"` would have revealed it. The agent downloaded 28 MB of JRE unnecessarily before realizing Java was already there. **Always use `ls` first, not `which`/`where`.**

2. **QGIS was eating 3.5 GB RAM** as a background service. Killing `qgis-bin.exe` freed enough memory to run the build. The 14 other processes (Hermes agent, multiple Edge processes, Explorer, etc.) had already pushed system used to 86.7%. Free memory went from 4.2 GB → 18.6 GB just by killing QGIS.

3. **`taskkill /PID <pid> /F` works on Windows** to kill stuck processes by PID. Use `tasklist | grep <name>` first to find the PID.

**Lesson:** Before downloading anything >1 MB, run the 3 commands above. They take 5 seconds and routinely save 1+ hours.

## Installing Planetiler on Windows — the gotcha list

The single binary is on GitHub releases: <https://github.com/onthegomap/planetiler/releases>. The current file is `planetiler.jar` (~88 MB, fat-jar, includes all dependencies).

**Gotcha 1: Where is Java?**

Before doing anything, check if Java is already installed:
```bash
ls "/c/Program Files (x86)/jdk/bin/java.exe" 2>/dev/null && echo "Temurin 21 at C:\Program Files (x86)\jdk"
ls "/c/Program Files/Java/jdk-*/bin/java.exe" 2>/dev/null
wsl -e bash -c "java -version 2>&1"  # also check WSL
```

The 2026-07-17 session found Temurin 21 at `C:\Program Files (x86)\jdk\bin\java.exe` after `where java` and `which java` from msys git both returned nothing. **Always use absolute path** when invoking from msys git; the shell PATH search is unreliable on Windows.

If no JDK exists, install Temurin JRE 17 (41 MB Windows zip) via the Adoptium API:
```bash
curl -L -C - -o jre17.zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk"
unzip jre17.zip -d tools/jre17
JAVA="$(pwd)/tools/jre17/jdk-17.0.11+9-jre/bin/java.exe"
```

Planetiler requires Java 11+; 17 LTS or 21 LTS both work fine.

**Gotcha 2: Network speed will dominate total time**

The 2026-07-17 session hit 20 KB/s on the GitHub download. The 88 MB jar took ~50 minutes even with parallel connections. **Always** check the download speed before committing:

```bash
curl -L -o /dev/null -w "%{speed_download}\n" "https://github.com/onthegomap/planetiler/releases/download/v0.10.2/planetiler.jar"
```

If < 100 KB/s, plan for a long download. Use `curl -C -` so you can resume after any interruption. Background the download (`background=true, notify_on_complete=true`) and poll `du -h planetiler.jar` periodically — **never** foreground-wait for an 88 MB download.

**Gotcha 3: The fat-jar contains all dependencies — no Maven, no Gradle**

The 88 MB `planetiler.jar` is a fat-jar (uses the Shade plugin to bundle every transitive dependency). You do NOT need to install Maven, Gradle, or any Java library separately. `java -jar planetiler.jar` is the entire build command.

**Gotcha 4: Memory settings**

Default JVM heap is 25% of physical RAM. On a 32 GB Windows machine that's ~8 GB — plenty. For a country-scale PBF on a smaller machine, set explicitly:

```bash
"$JAVA" -Xmx6g -jar planetiler.jar --osm_path=... --output=...
```

For planet-scale (full OSM, ~100 GB PBF), use `-Xmx12g`. Planetiler's disk-spill architecture means it can process features larger than available RAM, but throughput drops significantly once you exceed heap.

**Gotcha 5: `--area=Australia` is the BBox filter**

Planetiler uses `--area=<name>` to filter the input to a geographic region. The named areas are defined at <https://github.com/onthegomap/planetiler/tree/main/planetiler-core/src/main/java/com/onthegomap/planetiler/reader/osm/area>. Common ones: `Australia`, `monaco`, `jakarta`, `us/midwest`, `us/west`, `us/south`, `us/northeast`, `us/pacific`. If the area you need isn't in the list, you can pass `--bbox=west,south,east,north` instead:

```bash
"$JAVA" -Xmx6g -jar planetiler.jar \
    --download=false \
    --bbox=110,-45,155,-10 \
    --osm_path="$PBF" \
    --output="$OUT"
```

`--area` and `--bbox` are mutually exclusive.

**Gotcha 6: `--download=true` triggers HUGE auxiliary shapefile downloads (NEW 2026-07-17)**

The `--area=Australia` profile (or any named area that uses the OpenMapTiles basemap profile) requires three auxiliary data files that Planetiler downloads to `data/sources/` on first run:

| File | Source | Size | Typical speed | Total time |
|---|---|---|---|---|
| `natural_earth_vector.sqlite.zip` | naciscdn.org | 434 MB | 500-700 KB/s | 10-15 min |
| `lake_centerline.shp.zip` | github.com/acalcutt/osm-lakelines | 80 MB | 50-500 KB/s | 5-15 min |
| `water-polygons-split-3857.zip` | osmdata.openstreetmap.de | **920 MB** | **15-30 KB/s** (very slow German OSM mirror) | **45-90 min** |

**Water polygons is the wall-clock bottleneck** — `osmdata.openstreetmap.de` is geographically far from most CN users and seems to throttle aggressively. On a typical home network the download will take 30-90 minutes.

If you want to avoid the auxiliary data download (to test only the PBF processing), write a custom Java Profile that does NOT call `.addPreprocessor("natural_earth")` etc. See `templates/planetiler-custom-profile.java` for the minimal example. The built-in `--area=` profile always downloads all three.

You can also manually pre-download these files via curl into `data/sources/` — Planetiler will skip the download and just process them:
```bash
mkdir -p data/sources
curl -L -C - -o data/sources/natural_earth_vector.sqlite.zip \
    "https://naciscdn.org/naturalearth/packages/natural_earth_vector.sqlite.zip"
curl -L -C - -o data/sources/lake_centerline.shp.zip \
    "https://github.com/acalcutt/osm-lakelines/releases/download/v12/lake_centerline.shp.zip"
curl -L -C - -o data/sources/water-polygons-split-3857.zip \
    "https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip"
```

**Gotcha 6b: `--download=false` skips Geofabrik auto-download only**

If the PBF is already on disk (as in the 2026-07-17 session where the user provided `australia-260404.osm.pbf`), pass `--download=false`. But this still doesn't skip the **aux shapefile** downloads — those only get skipped if the files already exist at `data/sources/...`. So the user's workflow is:
- `--download=false` + local PBF + aux files already at `data/sources/` → pure PBF processing, no network needed.
- `--download=true` + local PBF + no aux files at `data/sources/` → 30-90 min aux download + 30 min processing.

The default (no `--download` flag) is `false`. With `--download=false` AND no aux files, Planetiler exits with `IllegalArgumentException: data\sources\lake_centerline.shp.zip does not exist`. This is the most common beginner error.

If Planetiler's `--download=true` keeps partial-downloading the same file, the workaround is to manually curl the file to the expected path before running Planetiler — it skips the download if the file exists.

**Gotcha 6d (NEW 2026-07-21 — CN networks):** Java's built-in downloader often fails DNS/TLS
to GitHub (`UnresolvedAddressException` on `lake_centerline.shp.zip`) even when Node `fetch`
and `curl -L -C -` work. Prefer pre-fetching the three aux zips with curl/Node into
`data/sources/`, then always pass `--download=false --download_dir=<abs path>`. See Pitfall 80
in `SKILL.md`.

**Gotcha 6c: OpenMapTiles source-layer names — CORRECTED 2026-07-18**

The `--area=` profile emits these source-layers (NOT the user-chosen names you'd pick in pure-Python output, and NOT what this file originally listed under 6c — that list was placeholders from a tutorial that turned out to be wrong for real Planetiler OpenMapTiles output):

```
transportation       all highway=* (motorway, trunk, ..., path, footway) — singular, RENAMED
transportation_name  shield-text layer (z6+ only)
building             building=* polygons — SINGULAR, minzoom=13
place                cities + towns — SINGULAR, minzoom=0
poi                  POI nodes — SINGULAR, minzoom=12
landcover            ground tint — NEW (not in raw OSM), minzoom=3
landuse              parks/forests/farmland — uses class= field, not OSM landuse= value
water                ocean + lake polygons
waterway             rivers/streams as lines
water_name           water body labels
park                 park polygons (subset of landuse)
boundary             admin_level ≤ 6 borders — SINGULAR
aeroway              runway/taxiway polygons
mountain_peak        z7+
aerodrome_label      z8-14
housenumber          z14 only
```

**Crucial**: classic tutorial-style names `places`/`roads`/`buildings`/`pois` are **wrong** for real Planetiler OpenMapTiles output. Use **`transportation`, `building` (singular), `place` (singular), `poi` (singular), `boundary` (singular)** instead. Field names differ too: roads have `class` ∈ {motorway, trunk, primary, secondary, tertiary, minor, service, path, rail, aerialway}, NOT OSM raw `highway` value.

Update the MapLibre style's `source-layer` and property names to match.

## Real measured numbers from the 2026-07-18 session (CORRECTED)

The estimates below are from sessions where Planetiler was NOT run end-to-end due to network constraints. Real numbers from the 2026-07-17 session that built a working Australia PMTiles:

| PBF size | Region | -Xmx setting | Wall time | Output size |
|---|---|---|---|---|
| 887 MB | Australia | 6 GB | **37 min** (incl. ~30 min aux shapefile download + 7 min PBF process) | **1.24 GB** |

**Wall time breakdown** (Australia 887 MB, 6 GB heap, 720 KB/s download):
- natural_earth 434 MB → 10 min
- lake_centerline 80 MB → 5 min
- water_polygons 927 MB → 25 min (the bottleneck — German OSM mirror is slow)
- osm_pass1 + osm_pass2 + sort + archive → ~7 min
- **Total: ~47 min** end-to-end including aux downloads; ~17 min if aux files are pre-cached locally.

**Output size is ~1.24 GB for Australia OpenMapTiles profile z0-z14** because Planetiler emits all 16 source-layers with full detail across all 15 zoom levels. PMTiles + Range Requests serve only visible tiles, so the user only downloads a few MB at a time even though the file is huge.

**These are the numbers to plan around for an 887 MB country PBF on a similar machine. For smaller regions (e.g. Monaco — 1 MB PBF) the run completes in seconds.**

Planetiler's heap usage is **bounded by the BBox** because it only keeps features in the AOI in memory. A 100 GB planet PBF with `--area=Australia` uses roughly the same heap as the 887 MB Australia-only PBF.

## What you get out — the output structure

Planetiler's built-in basemap profile produces these source-layers, which match what `demo/index.html` style already references:

| Source-layer | Geometry | Contents |
|---|---|---|
| `earth` | polygon | Country/ocean background polygons |
| `natural` | polygon | Land/sea/coastline |
| `landuse` | polygon | Forest, grass, farmland, residential, commercial, industrial, cemetery, etc. |
| `water` | polygon + line | Lakes, rivers, streams, waterway networks |
| `physical_line` | line | Coastline, country borders |
| `physical_point` | point | Peaks, volcanoes |
| `buildings` | polygon | Every `building=*` way (yes, residential, commercial, ...) |
| `places` | point | city/town/village/suburb/hamlet/locality, with population |
| `pois` | point | amenity, shop, tourism, leisure, office, etc. |
| `roads` | line | Every `highway=*` value (motorway → path), with class, ref, network |
| `transit` | line | railway, light_rail, subway, aerialway |
| `buildings` (again) | polygon | (same layer, more detail at high zoom) |
| `mask` | polygon | Tile boundary buffers for label rendering |
| `boundaries` | line | admin_level 2-10 admin boundaries |

If you only want a subset, you can write a custom Java profile — but for a first PoC, the built-in basemap profile is the right choice.

## Common errors

**"Unsupported class file major version"** — your Java is too old. Planetiler needs Java 11+. Upgrade to 17 LTS or 21 LTS.

**"OutOfMemoryError: Java heap space"** — bump `-Xmx`. For an 887 MB country PBF, 6 GB is enough. For a full planet, 12-16 GB.

**"java.net.SocketException: Connection reset"** during Geofabrik download — pass `--download=false` (you already have the PBF locally) or retry.

**"java.io.FileNotFoundException: ...planetiler.jar"** — absolute path issue. Use the full path to the jar, not a relative one.

**"no main manifest attribute"** — you ran `java planetiler.jar` instead of `java -jar planetiler.jar`. The `-jar` flag is required to read the fat-jar's manifest.

**Planetiler killed mid-run leaves a 0-byte `output.pmtiles`** (NEW 2026-07-17): Planetiler opens the output file at the start of the `archive:` phase and writes the header, then proceeds to fill in tile data. If the run is killed (OOM-killer, `taskkill`, Ctrl-C, parent shell dying) ANY time after archive starts, the file is left at **0 bytes** because Planetiler hasn't begun writing the variable-length data section. Symptom: `ls -la output.pmtiles` reports 0 bytes even though Planetiler log shows "encoded 47/74 tiles". **Fix sequence**:
1. Before any new Planetiler run, `mv output.pmtiles output.pmtiles.bak.N`.
2. After Planetiler finishes (look for the `Done in Ns` log line), verify `ls -la output.pmtiles` shows size > 1 MB.
3. If 0 bytes: restore from bak and run Planetiler again with the same command.

## Verifying the output

After Planetiler finishes (it prints `Done in Ns` to stdout), verify the PMTiles:

```python
import struct
with open('demo/australia.pmtiles', 'rb') as f:
    head = f.read(127)
    assert head[:7] == b'PMTiles', 'wrong magic'
    print('magic + spec OK; size =', len(open('demo/australia.pmtiles','rb').read()), 'bytes')
```

Then load in Chrome via the existing demo. The map should:
- Render all the layers the style references (places, roads, buildings, water, landuse, pois, transit, boundaries, aeroway)
- Pan and zoom smoothly
- Show no horizontal/vertical "slash" lines (this is the bug that Planetiler's tile clipping fixes)
- At zoom 3, show major roads across the country
- At zoom 6+, show residential roads and individual buildings
- At zoom 8+, show footways and detail buildings

If the demo shows slashes despite Planetiler, the issue is in the Java profile or the style — not in the data. See the parent skill's Pitfall 13 for symptoms and Pitfall 10 for `tile_compression` header mismatches.
