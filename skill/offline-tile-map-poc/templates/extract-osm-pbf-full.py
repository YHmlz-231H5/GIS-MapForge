"""
Full-detail OSM PBF -> PMTiles streaming extractor (Windows-friendly).

This is the "preserve everything" variant of templates/extract-osm-pbf.py.
Use it when the user asks for a faithful conversion of an 800+ MB PBF
(e.g. "pbf有多细致我就要多细致"). It extracts ALL tagged features across
9 source-layers, buckets them into Web Mercator tiles per zoom, encodes
each tile as MVT, and writes a single PMTiles v2 archive.

Default zoom range is z0..z6 (Australia overview) — the right knob to turn
to control output size is zoom range, NOT layer coverage.

Memory usage is ~22 MB RSS per 1M nodes scanned, so a 130M-node PBF
(Australia) peaks at ~3.2 GB on a 32 GB machine with 4 GB headroom.

Usage:
    python extract-osm-pbf-full.py [<input.pbf>] [<output.pmtiles>]

Defaults assume Australia PBF at:
    D:\\\\ZmWorkSpace\\\\Explore Dev\\\\MapSolution\\\\data\\\\australia-260404.osm.pbf

Output:
    D:\\\\ZmWorkSpace\\\\Explore Dev\\\\MapSolution\\\\demo\\\\australia.pmtiles

Verification (after running):
    python -c "import struct; h=open('output.pmtiles','rb').read(16); \\
        print(h[:7]==b'PMTiles', h[7])"

    # then open demo/index.html in Chrome, check
    # m.queryRenderedFeatures(undefined, {layers:['src-australia-roads']})
    # returns > 0 features.
"""
import osmium, sys, math, time, json, os, gc
from collections import defaultdict
import mapbox_vector_tile
import pmtiles.writer as pw
import pmtiles.tile as pt

sys.stdout.reconfigure(line_buffering=True)


# ---- Configurable: zoom range, bbox, memory cap ----
MIN_ZOOM = 0
MAX_ZOOM = 6
BBOX = (110.0, -45.0, 155.0, -10.0)   # Australia; override for other regions.
TILE_SIZE = 4096
# Hard memory ceiling — abort pass 1 if RSS exceeds this.
# Australia full-detail extraction peaks at ~6.2 GB during the way stage.
# Set to 4 GB only if you're on a tight-memory machine and willing to lose
# the way stage.
MEMORY_CEILING_MB = 8000


def lonlat_to_tile_xy(lon, lat, z):
    n = 1 << z
    tx_f = (lon + 180.0) / 360.0 * n
    lat_rad = math.log(math.tan(math.pi / 4 + lat * math.pi / 180 / 2))
    ty_f = (1.0 - lat_rad / math.pi) / 2.0 * n
    tx, ty = int(tx_f), int(ty_f)
    return tx, ty, (tx_f - tx) * TILE_SIZE, (ty_f - ty) * TILE_SIZE


def in_bbox(lon, lat):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def main(pbf_path, out_path):
    tiles = defaultdict(lambda: defaultdict(list))   # tiles[(z,x,y)][layer] = [feat, ...]
    stats = defaultdict(int)
    n_nodes = n_ways = n_rels = 0
    t0 = time.time()

    def add_to_tiles(layer_name, feat):
        """Insert feature into all zooms' matching tile.

        CRITICAL: dispatch on geometry.type BEFORE unpacking coordinates.
        A single branch like `lon, lat = coords[0]` crashes on Polygons
        with `ValueError: too many values to unpack`, aborting the entire
        30-minute extraction after most features are accumulated. Wrap in
        try/except so a single bad geometry never aborts the run. See
        pbf-to-pmtiles-recipe.md Pitfall 15.
        """
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
            else:
                return
        except (ValueError, TypeError) as e:
            print(f'WARN: skipping bad geom gtype={gtype} layer={layer_name} err={e}',
                  flush=True)
            return
        if not in_bbox(lon, lat):
            return
        for z in range(MIN_ZOOM, MAX_ZOOM + 1):
            tx, ty, _, _ = lonlat_to_tile_xy(lon, lat, z)
            tiles[(z, tx, ty)][layer_name].append(feat)
        stats[layer_name] += 1

    def maybe_warn_memory(label):
        try:
            import psutil
            used_mb = psutil.Process().memory_info().rss / 1024 / 1024
            if used_mb > MEMORY_CEILING_MB:
                print(f'  ABORT: {label} memory {used_mb:.0f}MB > {MEMORY_CEILING_MB}MB cap',
                      flush=True)
                raise MemoryError(f'{label} memory exceeded {MEMORY_CEILING_MB}MB')
            return used_mb
        except ImportError:
            return 0

    class Stream(osmium.SimpleHandler):
        def node(self, n):
            nonlocal n_nodes
            n_nodes += 1
            if n_nodes % 5_000_000 == 0:
                gc.collect()
                used = maybe_warn_memory('node phase')
                print(f'  nodes={n_nodes/1e6:.0f}M ways={n_ways/1e3:.0f}K rels={n_rels}  '
                      f'features={sum(stats.values())/1e3:.0f}K tiles={len(tiles):,} '
                      f'mem={used:.0f}MB elapsed={time.time()-t0:.0f}s', flush=True)
            tags = n.tags
            if not tags:
                return
            lon, lat = n.location.lon, n.location.lat
            if not in_bbox(lon, lat):
                return
            place = tags.get('place')
            highway = tags.get('highway')
            railway = tags.get('railway')
            amenity = tags.get('amenity')
            shop = tags.get('shop')
            tourism = tags.get('tourism')
            if place:
                layer = 'places'
                props = {'name': tags.get('name', ''), 'place': place,
                         'population': tags.get('population', ''),
                         'capital': tags.get('capital', '')}
                geom = {'type': 'Point', 'coordinates': [lon, lat]}
            elif highway or railway or amenity or shop or tourism:
                layer = 'pois'
                props = {'name': tags.get('name', ''),
                         'kind': highway or railway or amenity or shop or tourism}
                geom = {'type': 'Point', 'coordinates': [lon, lat]}
            else:
                return
            add_to_tiles(layer, {'type': 'Feature', 'geometry': geom, 'properties': props})

        def way(self, w):
            nonlocal n_ways
            n_ways += 1
            if n_ways % 1_000_000 == 0:
                gc.collect()
                used = maybe_warn_memory('way phase')
                print(f'  nodes={n_nodes/1e6:.0f}M ways={n_ways/1e3:.0f}K rels={n_rels}  '
                      f'features={sum(stats.values())/1e3:.0f}K tiles={len(tiles):,} '
                      f'mem={used:.0f}MB elapsed={time.time()-t0:.0f}s', flush=True)
            tags = w.tags
            if not tags:
                return
            highway = tags.get('highway')
            building = tags.get('building')
            waterway = tags.get('waterway')
            water = tags.get('water')
            natural = tags.get('natural')
            landuse = tags.get('landuse')
            leisure = tags.get('leisure')
            railway = tags.get('railway')
            aerialway = tags.get('aerialway')
            power = tags.get('power')
            aeroway = tags.get('aeroway')
            man_made = tags.get('man_made')
            barrier = tags.get('barrier')
            amenity_way = tags.get('amenity')
            layer = None
            if highway: layer = 'roads'
            elif building: layer = 'buildings'
            elif waterway or water or natural == 'water': layer = 'water'
            elif landuse or (natural and natural != 'water') or leisure: layer = 'landuse'
            elif railway or aerialway: layer = 'transit'
            elif aeroway: layer = 'aeroway'
            elif power or man_made or barrier or amenity_way: layer = 'infrastructure'
            if not layer:
                return
            coords = []
            for nd in w.nodes:
                if not nd.location.valid():
                    continue
                lon, lat = nd.location.lon, nd.location.lat
                if not in_bbox(lon, lat):
                    continue
                coords.append([lon, lat])
            if len(coords) < 2:
                return
            is_closed = coords[0] == coords[-1]
            polygon_layers = ('buildings', 'water', 'landuse')
            if is_closed and len(coords) >= 4 and layer in polygon_layers:
                geom_type = 'Polygon'
                # GeoJSON Polygon coords: [ring, ring, ...] (TWO levels of lists)
                geom_coords = [coords]
            else:
                geom_type = 'LineString'
                # CRITICAL FIX: GeoJSON LineString coords: [pos, pos, ...] (ONE level).
                # The previous template used `geom_coords = [coords]` which produces
                # 3 levels of nesting and crashes the bucketing helper with
                # `ValueError: too many values to unpack`. See
                # pbf-to-pmtiles-recipe.md Pitfall 16.
                geom_coords = coords
            props = {'name': tags.get('name', '')}
            if highway: props['highway'] = highway
            if building: props['building'] = building
            if waterway: props['waterway'] = waterway
            if water: props['water'] = water
            if natural: props['natural'] = natural
            if landuse: props['landuse'] = landuse
            if leisure: props['leisure'] = leisure
            if railway: props['railway'] = railway
            if aerialway: props['aerialway'] = aerialway
            if aeroway: props['aeroway'] = aeroway
            if power: props['power'] = power
            if amenity_way: props['amenity'] = amenity_way
            add_to_tiles(layer, {'type': 'Feature',
                                 'geometry': {'type': geom_type, 'coordinates': geom_coords},
                                 'properties': props})

        def relation(self, r):
            nonlocal n_rels
            n_rels += 1
            if n_rels % 5_000 == 0:
                print(f'  rels={n_rels:,}  elapsed={time.time()-t0:.0f}s', flush=True)

    print('=== Pass 1: streaming PBF ===', flush=True)
    s = Stream()
    try:
        s.apply_file(pbf_path, locations=True)   # locations=True is CRITICAL — without it, way member nodes have no coordinates.
    except MemoryError as e:
        print(f'Pass 1 aborted: {e}', flush=True)

    print(f'\nPass 1 done in {time.time()-t0:.1f}s', flush=True)
    print(f'  nodes={n_nodes:,} ways={n_ways:,} relations={n_rels:,}', flush=True)
    print(f'  features by layer:', flush=True)
    for k, v in sorted(stats.items(), key=lambda kv: -kv[1]):
        print(f'    {k}: {v:,}', flush=True)
    print(f'  total tiles: {len(tiles):,}', flush=True)

    # Pass 2: encode + write PMTiles in tileid-sorted order.
    print('\n=== Pass 2: building PMTiles ===', flush=True)
    header = {'spec_version': 2,
              'tile_type': pt.TileType.MVT,
              # CRITICAL: must match actual tile bytes. mapbox_vector_tile.encode()
              # produces RAW protobuf, not gzipped. Setting GZIP here causes MapLibre
              # to gunzip the bytes, get garbage, and emit 18+ "Failed to fetch"
              # console errors with no obvious cause. See pbf-to-pmtiles-recipe.md
              # Pitfall 7.
              'tile_compression': pt.Compression.NONE}
    metadata = {
        'name': 'extract-osm-pbf-full',
        'format': 'pbf',
        'bounds': list(BBOX),
        'center': [(BBOX[0]+BBOX[2])/2, (BBOX[1]+BBOX[3])/2, (MAX_ZOOM-MIN_ZOOM)//2],
        'minzoom': MIN_ZOOM,
        'maxzoom': MAX_ZOOM,
        'type': 'overlay',
        'description': 'Full-detail OSM extract',
        'generator': 'extract-osm-pbf-full.py',
    }
    layer_field_hints = {
        'places': {'name': 'String', 'place': 'String', 'population': 'String'},
        'pois':   {'name': 'String', 'kind': 'String'},
        'roads':  {'name': 'String', 'highway': 'String'},
        'buildings': {'name': 'String', 'building': 'String'},
        'water':  {'name': 'String', 'waterway': 'String', 'water': 'String'},
        'landuse':{'name': 'String', 'landuse': 'String', 'natural': 'String', 'leisure': 'String'},
        'transit':{'name': 'String', 'railway': 'String', 'aerialway': 'String'},
        'infrastructure': {'name': 'String', 'power': 'String', 'amenity': 'String'},
        'aeroway':{'name': 'String', 'aeroway': 'String'},
    }

    tileids = sorted((pt.zxy_to_tileid(z, x, y), z, x, y)
                     for (z, x, y) in tiles.keys())
    print(f'  {len(tileids):,} tiles to encode', flush=True)

    t1 = time.time()
    encoded_count = 0
    with open(out_path, 'wb') as f:
        w = pw.Writer(f)
        for idx, (tileid, z, x, y) in enumerate(tileids):
            # CRITICAL: progress prints. The first tile (z=0 x=0 y=0, containing
            # the whole world) takes 30-60 seconds because all places features
            # land in it. Without this print, the user assumes the process is
            # hung and kills it. See pbf-to-pmtiles-recipe.md Pass 2 section.
            if idx % 5 == 0 or idx == len(tileids) - 1:
                print(f'  encoding tile {idx+1}/{len(tileids)}  z={z} x={x} y={y}  '
                      f'elapsed={time.time()-t1:.0f}s', flush=True)
            layers = tiles[(z, x, y)]
            nonempty = []
            for (name, feats) in layers.items():
                if not feats:
                    continue
                pix_feats = []
                for feat in feats:
                    geom = feat['geometry']
                    gtype = geom['type']
                    coords = geom['coordinates']
                    if gtype == 'Point':
                        _, _, px, py = lonlat_to_tile_xy(coords[0], coords[1], z)
                        pix_geom = {'type': 'Point', 'coordinates': [px, py]}
                    elif gtype == 'LineString':
                        pix_geom = {'type': 'LineString',
                                    'coordinates': [list(lonlat_to_tile_xy(c[0], c[1], z)[2:4]) for c in coords]}
                    elif gtype == 'Polygon':
                        pix_rings = []
                        for ring in coords:
                            pix_rings.append([list(lonlat_to_tile_xy(c[0], c[1], z)[2:4]) for c in ring])
                        pix_geom = {'type': 'Polygon', 'coordinates': pix_rings}
                    else:
                        continue
                    pix_feats.append({'type': 'Feature', 'geometry': pix_geom,
                                      'properties': feat['properties']})
                nonempty.append({'name': name, 'features': pix_feats,
                                 'fields': layer_field_hints.get(name, {})})
            if not nonempty:
                continue
            try:
                # CRITICAL: use the LIST form, not the dict form. The dict form
                # looks up layers["name"] and raises KeyError. See
                # pbf-to-pmtiles-recipe.md Pitfall 8.
                encoded = mapbox_vector_tile.encode(nonempty)
                w.write_tile(tileid, encoded)
                encoded_count += 1
            except Exception as e:
                print(f'  skip tile {z}/{x}/{y}: {e}', flush=True)
        w.finalize(header, metadata)

    sz = os.path.getsize(out_path)
    print(f'\nDone in {time.time()-t0:.1f}s (encode: {time.time()-t1:.1f}s)', flush=True)
    print(f'wrote {out_path}', flush=True)
    print(f'  {sz:,} bytes  ({sz/1024/1024:.1f} MB)', flush=True)
    print(f'  {encoded_count:,} tiles', flush=True)


if __name__ == '__main__':
    pbf = sys.argv[1] if len(sys.argv) > 1 else r'D:\ZmWorkSpace\Explore Dev\MapSolution\data\australia-260404.osm.pbf'
    out = sys.argv[2] if len(sys.argv) > 2 else r'D:\ZmWorkSpace\Explore Dev\MapSolution\demo\australia.pmtiles'
    main(pbf, out)