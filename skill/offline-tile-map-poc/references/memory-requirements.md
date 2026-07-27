# Memory Requirements for PBF→PMTiles on a Workstation

Captured during the 2026-07-17 Australia PBF session when OS OOM-killer
terminated the build mid-way through the way stage.

## Why this exists

The user has a 32 GB Windows machine with 14 other processes already
consuming 86.7% of RAM — leaving only **4.2 GB available**. The first
attempts at the 887 MB Australia PBF using a pure-Python pipeline
(osmium + mapbox_vector_tile + pmtiles) OOM-killed repeatedly during the
way stage. The math below is what determines whether a given configuration
will finish on a given machine.

## Memory usage by technique (measured on the 887 MB Australia PBF)

| Configuration | Node stage peak | Way stage peak | 4 GB available? |
|---|---|---|---|
| **osmium + GeoJSON + pmtiles.Writer** (no clipping, in-memory tiles dict, z=0..6) | 3.2 GB | **6.2 GB** | ❌ OOM at way stage |
| **osmium + mercantile.tiles + shapely.intersection** (full clip, no fast path, z=0..4) | 4.5 GB | **8+ GB** | ❌ bad allocation at 25M nodes |
| **Same with fast-path** (skip shapely when feature is fully in tile, z=0..4) | 5.0 GB | **12+ GB** | ❌ SIGSEGV (OOM killer) at 27M nodes |
| **osmium extract + GeoJSON only** (no ways, points only) | 3.2 GB | n/a | ✅ works |
| **Planetiler (Java, 0.8 GB heap setting)** (estimated) | 2 GB | 4-6 GB | ⚠️ borderline |
| **tippecanoe + osmium-tool (real tools, on Linux)** | 2-3 GB | 4-8 GB | ❌ too tight |

**Key insight**: node phase is cheap (~3 GB peak for 130M nodes), way phase
is the bottleneck. Even with clip fast-path that skips ~95% of shapely
calls, the cumulative OOM still triggers.

## Linear slope formula

For the in-memory tiles-dict pattern (no clip), RSS grows at approximately
**22 MB per 1M nodes scanned** for the Australia PBF (130M nodes → 3.2 GB).
Slope is consistent because Python dict references dominate — features are
referenced from 7 tile-bucket lists (one per zoom), not copied.

**Budget formula**: `available_RSS_MB > 22 × nodes_in_millions × 1.5`
(×1.5 for way-stage headroom; way stage adds ~3 GB on top of node stage).

| PBF size | Nodes (approx) | Min available RAM |
|---|---|---|
| 50 MB (small city) | 8M | ~270 MB |
| 200 MB (small country) | 30M | ~1 GB |
| 500 MB (medium country) | 75M | ~2.5 GB |
| 887 MB (Australia) | 131M | ~4.5 GB (tight) — needs 6+ GB for safety |
| 1 GB (large country) | 150M | ~5 GB |
| 10 GB (continent) | 1.5B | ~50 GB (impractical on a workstation) |
| 100 GB (planet) | 15B | ❌ Python approach is not feasible |

## The 4 GB wall — what to do

If your machine has < 6 GB available RSS during the build, the
pure-Python approach will not finish. Options, in order of preference:

### 1. Free memory on the workstation (cheapest)

Close browsers, IDEs, other dev tools, Docker containers, JVM instances.
Verify with `psutil.virtual_memory().available` from a Python shell or
`tasklist | grep -i python` in bash. On a 32 GB Windows machine with
14 processes running, 4 GB free is the typical "developer workstation"
baseline — you can usually push this to 8-10 GB by killing what's not
needed.

### 2. Reduce zoom range, NOT layer coverage (right knob)

```python
# Bad: cut layers to save memory — user wanted "pbf有多细致我就要多细致"
MAX_ZOOM = 4  # was 6
# Drop pois, drop landuse, drop buildings — WRONG

# Good: keep all layers, cap zoom range
MAX_ZOOM = 4  # same
# Keep all 9 source-layers — right
```

z=0..z4 vs z=0..z6 cuts the in-memory feature count by ~16× (4² = 16
vs 2⁶ = 64 tiles per feature per zoom). The output PMTiles is much
smaller and the demo still shows a useful country overview.

### 3. Use Planetiler via WSL (Java, low memory)

Planetiler is a Java program that uses an in-memory cache with disk
spill. It can process a 887 MB country PBF with **0.8 GB heap**, which
fits on 4 GB-available machines. Install path on Windows with WSL:

```bash
wsl -e bash -c "\
  sudo apt-get update && \
  sudo apt-get install -y openjdk-17-jdk-headless && \
  cd /tmp && git clone https://github.com/openmaptiles/planetiler && \
  cd planetiler && ./mvnw -DskipTests package && \
  java -Xmx800m -jar planetiler.jar --area=australia \
    --download=https://download.geofabrik.de/australia-oceania-latest.osm.pbf \
    --output=australia.mbtiles"
# (but mbtiles, not pmtiles — convert with `pmtiles convert`)
```

Caveat: `apt-get install openjdk-17-jdk-headless` on a fresh WSL install
can take 10-20 minutes due to package download. Plan accordingly.

### 4. Run on a different machine (most reliable)

If a 16 GB+ machine is available (colleague's workstation, cloud VM,
Hetzner dedicated server for €4/month), do the build there and copy the
`.pmtiles` over. The build is bandwidth-light (only reads the PBF,
writes one file).

```bash
# On the build host
python build_australia_streaming.py
# produces australia.pmtiles (293 MB)

# Transfer (1 GB on the wire)
rsync -av australia.pmtiles user@workstation:/path/to/demo/

# On the demo workstation, no build needed; the PMTiles is loaded
# directly via the existing server.py.
```

### 5. Pre-process: split the PBF geographically

Use `osmium extract` (or `osmium-tool extract-with-padding`) to split a
country PBF into per-state PBF files. Process each separately, then
either:
- Combine the resulting PMTiles with `pmtiles tile-join` (or the
  `tile-join` tool from tippecanoe), or
- Serve them as separate sources and switch in the demo.

This bounds peak memory to one state at a time but requires extra
orchestration.

## Diagnosing "killed at way stage"

If your build process dies silently at the way stage with no Python
traceback, the OS OOM-killer terminated it. Symptoms:
- Process disappears from `tasklist` (Windows) or `ps` (Unix) without
  exit code
- Last log line is the node-phase summary, not the way-phase summary
- `dmesg | grep -i oom` (Linux) or Windows Event Viewer shows
  "out of memory" events
- A previous build of the same script that worked has suddenly stopped
  working → other processes have eaten memory

Quick check on Windows:
```powershell
# Total and available memory
Get-CimInstance Win32_OperatingSystem | Select TotalVisibleMemorySize, FreePhysicalMemory

# Top memory consumers
Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select -First 10 Name, @{N='Mem(MB)';E={[int]($_.WorkingSet64/1MB)}}
```

## See also

- `references/pbf-to-pmtiles-recipe.md` — the main recipe; Pitfall 17
  has the in-memory tiles-dict memory curve table.
- `references/tile-clipping-geometry.md` — the geometry clipping recipe;
  combining clipping with the 4 GB wall is what made the 2026-07-17 run
  fail. The two topics are tightly coupled.
