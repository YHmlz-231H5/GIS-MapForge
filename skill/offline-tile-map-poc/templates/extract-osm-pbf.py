"""Extract a small demo subset from an OSM PBF and write GeoJSON.

Tweak the `KEEP_PLACES`, `KEEP_HIGHWAYS`, and `BBOX_FILTER` constants below
to match your dataset and demo needs.

Usage:
    python extract-osm-pbf.py <input.pbf> <output.geojson>

Performance (Australia 887 MB, single thread, 32 GB RAM):
    - ~5-7 min to scan all dense nodes
    - 2-3 min to process ways + relations
    - Output ~5-20 MB GeoJSON depending on filter

For PMTiles generation (Stage 2/3), see references/pbf-to-pmtiles-recipe.md.
"""
import osmium, json, sys, time

sys.stdout.reconfigure(line_buffering=True)

# ---- Configurable filters ----
KEEP_PLACES = {'city', 'town', 'village', 'suburb', 'hamlet', 'locality', 'state'}
KEEP_HIGHWAYS = {'motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link'}
KEEP_BOUNDARY_ADMIN_LEVEL = '2'   # country-level boundary

# Optional bbox prefilter in (min_lon, min_lat, max_lon, max_lat).
# Set to None to keep everything in the PBF.
# Example: BBOX_FILTER = (110.0, -45.0, 155.0, -10.0) for Australia
BBOX_FILTER = None


def in_bbox(lon, lat):
    if BBOX_FILTER is None:
        return True
    return (BBOX_FILTER[0] <= lon <= BBOX_FILTER[2] and
            BBOX_FILTER[1] <= lat <= BBOX_FILTER[3])


class ExtractHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.places = []
        self.roads = []
        self.boundaries = []
        self.node_count = 0
        self.way_count = 0
        self.relation_count = 0
        self.t0 = time.time()

    def _elapsed(self):
        return time.time() - self.t0

    def node(self, n):
        self.node_count += 1
        if self.node_count % 500_000 == 0:
            print(f'  scanned {self.node_count:,} nodes ({self._elapsed():.0f}s)',
                  flush=True)
        tags = dict(n.tags)
        place = tags.get('place')
        if place in KEEP_PLACES:
            lon, lat = n.location.lon, n.location.lat
            if not in_bbox(lon, lat):
                return
            self.places.append({
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                'properties': {
                    'name': tags.get('name', ''),
                    'place': place,
                    'population': tags.get('population', ''),
                }
            })

    def way(self, w):
        self.way_count += 1
        if self.way_count % 200_000 == 0:
            print(f'  scanned {self.way_count:,} ways ({self._elapsed():.0f}s)',
                  flush=True)
        tags = dict(w.tags)
        highway = tags.get('highway')
        if highway in KEEP_HIGHWAYS:
            coords = []
            for nd in w.nodes:
                if nd.location.valid():
                    lon, lat = nd.lon, nd.lat
                    if not in_bbox(lon, lat):
                        continue
                    coords.append([lon, lat])
            if len(coords) >= 2:
                self.roads.append({
                    'type': 'Feature',
                    'geometry': {'type': 'LineString', 'coordinates': coords},
                    'properties': {
                        'name': tags.get('name', ''),
                        'highway': highway,
                        'ref': tags.get('ref', ''),
                    }
                })

    def relation(self, r):
        self.relation_count += 1
        if self.relation_count % 50_000 == 0:
            print(f'  scanned {self.relation_count:,} relations ({self._elapsed():.0f}s)',
                  flush=True)
        tags = dict(r.tags)
        if (tags.get('boundary') == 'administrative' and
                tags.get('admin_level') == KEEP_BOUNDARY_ADMIN_LEVEL):
            self.boundaries.append({
                'type': 'Feature',
                'id': r.id,
                'properties': {'name': tags.get('name', '')},
                'geometry': None,   # relation geometry needs full member resolution
            })


def main(in_path, out_path):
    print(f'Loading {in_path} ...', flush=True)
    h = ExtractHandler()
    h.apply_file(in_path)
    dt = h._elapsed()
    print(f'\n--- DONE in {dt:.1f}s ---', flush=True)
    print(f'  total nodes={h.node_count:,} ways={h.way_count:,} '
          f'relations={h.relation_count:,}', flush=True)
    print(f'  extracted: places={len(h.places):,}  roads={len(h.roads):,}  '
          f'boundaries={len(h.boundaries)}', flush=True)

    fc = {
        'type': 'FeatureCollection',
        'features': h.places + h.roads + h.boundaries,
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(fc, f, ensure_ascii=False)
    size = len(json.dumps(fc))
    print(f'  wrote {out_path}  ({size:,} bytes / {size/1024/1024:.2f} MB)', flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f'Usage: {sys.argv[0]} <input.pbf> <output.geojson>',
              file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])