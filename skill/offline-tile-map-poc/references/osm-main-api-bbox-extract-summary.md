# OSM main API /api/0.6/map?bbox= — the 5-line summary

This is the **short version** of `references/longhua-bbox-end-to-end.md` for
when you already know the goal (download a small bbox PBF without
Geofabrik's huge country-level extract) and just need the working pattern.

## When to use this instead of Geofabrik

Geofabrik is the default BUT:

- **Mainland China**, Japan, Korea, Singapore, most Asian / South American countries:
  Geofabrik offers **only** the country-level extract (e.g. `china-latest.osm.pbf` is 1.56 GB).
  At 30 KB/s that's 14 hours — not realistic for a city district PoC.
- **You want a tight bbox** rather than a country: Geofabrik has city-level
  extracts only for a small whitelist (Berlin, Bayern, NYC, ...). For a
  custom city / district shape, OSM main API is the fast path.

## The 5-line Python pattern

```python
import urllib.request, os
WEST, SOUTH, EAST, NORTH = 113.96, 22.58, 114.11, 22.78  # your bbox
url = (f"https://api.openstreetmap.org/api/0.6/map?"
       f"bbox={WEST},{SOUTH},{EAST},{NORTH}")
req = urllib.request.Request(url, headers={'User-Agent': 'YourApp/1.0'})
with urllib.request.urlopen(req, timeout=60) as r:
    data = r.read()
with open('output.osm', 'wb') as f:
    f.write(data)
```

That's the call. It's a single `bbox=` (commas, not pipes) where each
call returns the entire region as **OSM-XML with nodes + ways + relations**.
50K-node hard limit per call — for areas under ~150 km² you're fine in a
single request.

## Two critical pitfalls (read before you batch this)

### Pitfall A — Use Python `urllib`, NOT bash `curl`

**Symptom**: Files saved with `curl -L > tile.osm` from msys Git bash were
silently **truncated mid-stream**. Element counts of `<node ...>` were
correct (since nodes appear first in OSM XML), but **every `<way>` and
`<relation>` block was dropped**. The resulting merged PMTiles had zero
roads, no buildings, no admin boundaries.

**Verification — run on every downloaded tile**:

```python
def is_complete(path):
    if not os.path.exists(path): return False
    if os.path.getsize(path) < 1000: return False
    with open(path, 'rb') as f: data = f.read()
    return data.startswith(b'<?xml') and data.rstrip().endswith(b'</osm>')
```

**Fix**: use Python `urllib` (writes atomically, no msys pipe issues) OR
move to WSL/Linux. **Do not** trust bash `curl -o` for OSM XML on Windows.

### Pitfall B — 50K node limit per call (FIX WITH TILING)

For bboxes where the call returns > 50K nodes (large cities, ~150+ km²
urban areas), OSM main API responds with HTTP 400 "You requested too many
nodes (limit is 50000)". Tile the bbox into a grid and merge.

**Tile pattern** (CELL=0.02°≈ 25 km² is well under the limit):

```python
import math
from concurrent.futures import ThreadPoolExecutor, as_completed

tiles = []
for r in range(math.ceil((NORTH - SOUTH) / 0.02)):
    for c in range(math.ceil((EAST - WEST) / 0.02)):
        w, s = WEST + c*0.02, SOUTH + r*0.02
        e, n = w + 0.02, s + 0.02
        # Pad query bbox 0.005° each side so cross-tile ways aren't split.
        tiles.append({'id': f'r{r}c{c}',
                      'bbox': [w-0.005, s-0.005, e+0.005, n+0.005]})

def fetch(t):
    out = f"data/longhua/tile_{t['id']}.osm"
    if os.path.exists(out) and open(out,'rb').read().rstrip().endswith(b'</osm>'):
        return t['id']
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={','.join(map(str, t['bbox']))}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Longhua-PoC/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        with open(out, 'wb') as f: f.write(r.read())
    return t['id']

with ThreadPoolExecutor(max_workers=6) as ex:
    list(ex.map(fetch, tiles))
```

88 tiles @ ~3s each = **~5 min for 148 km²**.

## What comes AFTER

After downloading tiles, you need:

1. **Merge + tag-preserving PBF** — `references/longhua-bbox-end-to-end.md`
   has the full Python script (steps 3-5). `osmium.osm.mutable.Node()`'s
   `tags[k] = v` API silently drops tags, the file documents the
   `osmium.SimpleWriter` round-trip pattern that avoids the bug.

2. **Planetiler `--bbox` order** — must be **S,W,N,E** not W,S,E,N (the
   lake_centerline shapefile assumes latitude-first regardless of doc).
   Pass `--bbox=22.58,113.96,22.78,114.11` for the Longhua example.

3. **Subsequent pipeline** — `java -jar planetiler.jar ...` followed by
   `python scripts/audit-pmtiles.py ...` and the demo HTML.

## Overpass API — why it's NOT a fallback (NEW 2026-07-18)

Public Overpass mirrors (`overpass-api.de`, `overpass.kumi.systems`,
`overpass.osm.ch`, `maps.mail.ru`, `overpass.private.coffee`) were tested
in this run and **all returned HTTP 406 Not Acceptable** when called
from the user's environment (Windows + msys curl). The Python
`urllib` direct call against `api.openstreetmap.org` is more reliable.
Don't waste time debugging Overpass 406s — just use the main API.

## Critical links

- `references/longhua-bbox-end-to-end.md` — **the full working script**
  (88 tiles → 3.2 MB PBF → 3.6 MB PMTiles in ~6 min end-to-end)
- `scripts/audit-pmtiles.py` — verify the final PMTiles
- `references/planetiler-windows.md` — Planetiler invocation details
