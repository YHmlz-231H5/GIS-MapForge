# Longhua / arbitrary-bbox PBF → PMTiles — end-to-end working recipe (NEW 2026-07-18)

Captured after successfully running this 6-step pipeline end-to-end on
Longhua District (Shenzhen, China) → `demo/longhua.pmtiles` (3.6 MB,
16 layers, 0 console errors). This file is the **completed follow-up**
to `references/osm-main-api-bbox-extract.md` — that reference ends at
"Planetiler was about to be run" and this one starts there.

If you are coming here from `references/pbf-data-sources.md` after
rejecting Geofabrik/BBBike/Overpass, **start with this file** — it
contains the working Python script you can adapt for any small bbox
(typical city district).

## What works (the recipe that actually finished)

```python
# Step 1 — 88-tile grid (CELL=0.02° for ~25 km² per tile, well under
# OSM main API's 50K node limit per call).
import math
WEST, SOUTH, EAST, NORTH = 113.96, 22.58, 114.11, 22.78  # Longhua
CELL = 0.02

tiles = []
for r in range(math.ceil((NORTH - SOUTH) / CELL)):
    for c in range(math.ceil((EAST - WEST) / CELL)):
        w, e = WEST + c*CELL, WEST + (c+1)*CELL
        s, n = SOUTH + r*CELL, SOUTH + (r+1)*CELL
        # Pad query bbox by 0.005° on each side so cross-tile ways
        # aren't split between adjacent tiles.
        tiles.append({'id': f'r{r}c{c}',
                      'query_bbox': [w-0.005, s-0.005, e+0.005, n+0.005],
                      'cell_bbox':   [w, s, e, n]})

# Step 2 — Download via Python urllib (NOT curl — see `osm-main-api-bbox-extract.md`
# Pitfall B for why msys curl silently truncates).
import urllib.request, os
from concurrent.futures import ThreadPoolExecutor, as_completed

def is_complete(path):
    if not os.path.exists(path): return False
    if os.path.getsize(path) < 1000: return False
    with open(path, 'rb') as f: data = f.read()
    return data.startswith(b'<?xml') and data.rstrip().endswith(b'</osm>')

def fetch(t):
    out = f"data/longhua/tile_{t['id']}.osm"
    if is_complete(out): return f"skip {t['id']}"
    w, s, e, n = t['query_bbox']
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Longhua-PoC/1.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(out, 'wb') as f: f.write(data)
        return f"OK {t['id']} {len(data)//1024}KB"
    except Exception as e:
        return f"FAIL {t['id']} {e}"

# 6 workers × 0.4s spacing → ~88 tiles in ~5 min, 0 errors
remaining = [t for t in tiles if not is_complete(f"data/longhua/tile_{t['id']}.osm")]
with ThreadPoolExecutor(max_workers=6) as ex:
    futures = [ex.submit(fetch, t) for t in remaining]
    for f in as_completed(futures): print(f.result())

# Step 3 — Read all 88 tiles into raw dicts (no mutable API — it
# silently drops tags, see Pitfall E in `references/osm-main-api-bbox-extract.md`).
import osmium, glob
nodes, ways, rels = {}, {}, {}
class Accum(osmium.SimpleHandler):
    def node(self, n):
        try: lat, lon = n.location.lat, n.location.lon
        except: lat = lon = None
        nodes[n.id] = (lat, lon, dict(n.tags))
    def way(self, w): ways[w.id] = ([nd.ref for nd in w.nodes], dict(w.tags))
    def relation(self, r):
        rels[r.id] = ([(m.ref, str(m.type)) for m in r.members], dict(r.tags))

TILES = sorted([f for f in glob.glob('data/longhua/tile_*.osm') if is_complete(f)])
for f in TILES:
    Accum().apply_file(f, locations=True)
print(f"collected: {len(nodes):,} nodes, {len(ways):,} ways, {len(rels):,} relations")

# Step 4 — Round-trip via sorted OSM XML (escapes & < > in tag values,
# and ensures nodes → ways → relations order is preserved).
from xml.sax.saxutils import escape
def esc(v):
    if v is None: return ''
    return v.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')

XML = 'data/longhua.osm'
with open(XML, 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6">\n')
    for nid in sorted(nodes):
        lat, lon, tags = nodes[nid]
        if lat is None: continue
        attrs = f'id="{nid}" lat="{lat:.7f}" lon="{lon:.7f}"'
        tag_xml = ''.join(f'<tag k="{esc(k)}" v="{esc(v)}"/>' for k, v in tags.items())
        f.write(f'<node {attrs}>{tag_xml}</node>\n')
    for wid in sorted(ways):
        nd_xml = ''.join(f'<nd ref="{r}"/>' for r in ways[wid][0])
        tag_xml = ''.join(f'<tag k="{esc(k)}" v="{esc(v)}"/>' for k, v in ways[wid][1].items())
        f.write(f'<way id="{wid}">{nd_xml}{tag_xml}</way>\n')
    for rid in sorted(rels):
        mem_xml = ''.join(f'<member type="{t}" ref="{r}"/>' for r, t in rels[rid][0])
        tag_xml = ''.join(f'<tag k="{esc(k)}" v="{esc(v)}"/>' for k, v in rels[rid][1].items())
        f.write(f'<relation id="{rid}">{mem_xml}{tag_xml}</relation>\n')
    f.write('</osm>\n')

# Step 5 — XML → PBF via osmium.SimpleWriter (preserves tags correctly
# because we never went through the broken mutable API).
PBF = 'data/longhua.osm.pbf'
if os.path.exists(PBF): os.remove(PBF)
class W(osmium.SimpleHandler):
    def __init__(self, w): super().__init__(); self.w = w
    def node(self, n): self.w.add_node(n)
    def way(self, w):  self.w.add_way(w)
    def relation(self, r): self.w.add_relation(r)
out = osmium.SimpleWriter(PBF)
W(out).apply_file(XML, locations=True)
out.close()

# Step 6 — Planetiler archive. **NOTE the bbox order: S,W,N,E**
# (NOT the W,S,E,N order you see in most docs). The OpenMapTiles
# default profile loads LakeCenterline.shp, which interprets the first
# coordinate as latitude regardless of doc order — pass 113.96 first
# and the geotools transform throws "Latitude 113°30.6'N is out of
# range (>90)".
import subprocess
subprocess.run([
    r'C:\Program Files (x86)\jdk\bin\java.exe', '-Xmx4g',
    '-jar', 'tools/planetiler.jar',
    '--download=false', '--force',
    '--osm_path', PBF,
    '--bbox', f"{SOUTH},{WEST},{NORTH},{EAST}",  # S,W,N,E
    '--output', 'demo/longhua.pmtiles',
], cwd='D:/ZmWorkSpace/Explore Dev/MapSolution', check=True)
```

Runtime for Longhua (148 km², 88 tiles):

| Step | Time |
|---|---|
| 1. Tile grid computation | <1 s |
| 2. 88 tile downloads via `urllib` | ~5 min |
| 3. Read into dicts | 12 s |
| 4. Write sorted XML (47 MB) | 1 s |
| 5. XML → PBF (3.2 MB) | 1 s |
| 6. Planetiler archive (4 GB heap) | 34 s |
| **Total** | **~6 min** |

## Final state from this run

```
D:/ZmWorkSpace/Explore Dev/MapSolution/
├── data/
│   ├── longhua/                   (88 .osm XML tiles, ~87 MB total)
│   ├── longhua.osm                 (47 MB sorted OSM XML)
│   └── longhua.osm.pbf             (3.2 MB, 425 K nodes + 47 K ways + 1.5 K rels)
├── demo/
│   └── longhua.pmtiles             (3.6 MB, 16 OpenMapTiles layers)
```

## What's next (out of scope for this file)

To wire the Longhua PMTiles into the existing `demo/index.html` for a
3-region switcher (Firenze / Australia / Longhua), the
`templates/index-multi-region.html` pattern is the right starting
point. The `source-layer` names and the `class`-not-`highway` field
name follow OpenMapTiles schema — see `references/planetiler-output-validation.md`
and the Planetiler schema mapping table in `SKILL.md`.

## Why this recipe works when other paths failed (NEW 2026-07-18)

| Path tried | What broke | Reference |
|---|---|---|
| `osmium.osm.mutable.Node().tags[k] = v` | Silently dropped every tag (no exception). PMTiles rendered, but every feature was a `null island` of unclassified geometry. | this file, Step 3 |
| `osmium.SimpleWriter` with per-tile `apply_file()` | Produced mixed-type blocks. Planetiler rejected with `Elements must be sorted with nodes first, then ways, then relations`. | `references/osm-main-api-bbox-extract.md` Pitfall D |
| 3-PBF re-emit (nodes/ways/rels separately) | Worked but fragile — see Pitfall D in `references/osm-main-api-bbox-extract.md` | same |
| Bash `curl -L > tile.osm` | Silently truncated XML mid-stream, dropping all `<way>` and `<relation>` blocks. | `references/osm-main-api-bbox-extract.md` Pitfall B |
| Overpass API mirrors (all 5 tested) | Returned 406 Not Acceptable. | `references/osm-main-api-bbox-extract.md` |
| Geofabrik China 1.56 GB country PBF | 30 KB/s bandwidth → 14 hours. The skill now has `references/pbf-data-sources.md` covering alternatives. | `references/pbf-data-sources.md` |
| `--bbox=W,S,E,N` argument order | Java `TransformException: Latitude 113°30.6'N is out of range (>90)`. | this file, Step 6 |

The recipe above avoids every one of these failure modes.
