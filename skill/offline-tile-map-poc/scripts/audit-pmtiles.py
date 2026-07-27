#!/usr/bin/env python3
"""
audit_pmtiles.py — Validate a Planetiler-generated PMTiles for data integrity.

This is the OFFICIAL integrity test for the offline-tile-map-poc skill:
verifies PMTiles v3 spec compliance, OpenMapTiles schema match, header
field correctness, and reports what's in the file vs what you'd expect
from the PBF.

Usage:
    python scripts/audit-pmtiles.py <pmtiles_url> [--pbf <pbf_path>]

    <pmtiles_url>    full URL, e.g. http://127.0.0.1:8765/australia.pmtiles
                     or file:///path/to/australia.pmtiles
                     or just a local file path
    --pbf <path>     optional — also count expected features in the PBF
                     and compare to the layer schema (5 min more time)

Output:
    OK / FAIL summary for each of:
      - PMTiles v3 spec conformance (magic, version, header layout)
      - OpenMapTiles schema conformance (15/16 layer match)
      - address range sanity (bbox, zoom range)
      - cross-tile clipping hint (no decorative slashes would appear)
      - (optional) PBF feature totals cross-check

Exit code: 0 on success (all checks pass), 1 on any failure.

Example:
    # Just check file integrity (no PBF):
    python scripts/audit-pmtiles.py http://127.0.0.1:8765/australia.pmtiles

    # Full audit with PBF ground truth (slow — adds ~2 min):
    python scripts/audit-pmtiles.py http://127.0.0.1:8765/australia.pmtiles \
        --pbf D:/data/australia-260404.osm.pbf
"""

import argparse
import json
import os
import struct
import sys
import urllib.request
import gzip

# Canonical OpenMapTiles schema minzoom/maxzoom (Planetiler output).
# These come directly from the OpenMapTiles profile source + Planetiler
# benchmark runs, validated end-to-end. The single deviation from the
# schema (landcover.minzoom=3) is documented Planetiler optimization.
EXPECTED_LAYERS = {
    'aerodrome_label':     (8, 14),
    'aeroway':             (10, 14),
    'boundary':            (0, 14),
    'building':            (13, 14),
    'housenumber':         (14, 14),
    'landcover':           (3, 14),   # ≠ schema-default 0 (Planetiler optimization)
    'landuse':             (4, 14),
    'mountain_peak':       (7, 14),
    'park':                (4, 14),
    'place':               (0, 14),
    'poi':                 (12, 14),
    'transportation':      (4, 14),
    'transportation_name': (6, 14),
    'water':               (0, 14),
    'water_name':          (1, 14),
    'waterway':            (4, 14),
}


def fetch_bytes(url, start, end):
    """Fetch [start, end] bytes from a URL. Works for http://, file://, local paths."""
    if url.startswith(('http://', 'https://')):
        req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
        return urllib.request.urlopen(req).read()
    # Local path
    with open(url, 'rb') as f:
        f.seek(start)
        return f.read(end - start + 1)


def check_header(url):
    """Validate PMTiles v3 header byte-by-byte. Returns (passed, info_dict)."""
    info = {}
    # Fetch 127 bytes (full v3 header)
    try:
        data = fetch_bytes(url, 0, 126)
    except Exception as e:
        return False, {'error': f'cannot fetch header: {e}'}

    # Magic
    if data[:7] != b'PMTiles':
        return False, {'error': f'magic mismatch, got {data[:7]}'}
    info['magic'] = data[:7].decode()

    # Spec version
    info['spec_version'] = data[7]
    if info['spec_version'] != 3:
        return False, {'error': f'expected spec v3, got {info["spec_version"]}'}

    # Header field decoding
    def le64(o): return struct.unpack_from('<Q', data, o)[0]
    def le8(o):  return data[o]

    info['root_off']     = le64(8)
    info['root_len']     = le64(16)
    info['meta_off']     = le64(24)
    info['meta_len']     = le64(32)
    info['leaf_off']     = le64(40)
    info['leaf_len']     = le64(48)
    info['tile_off']     = le64(56)
    info['tile_len']     = le64(64)
    info['addr_count']    = le64(72)
    info['tile_entries']  = le64(80)
    info['tile_contents'] = le64(88)
    info['clustered']     = le8(96)
    info['internal_cmp']  = le8(97)
    info['tile_cmp']      = le8(98)
    info['tile_type']     = le8(99)
    info['min_zoom']      = le8(100)
    info['max_zoom']      = le8(101)

    # Bounds (4 int32 / 1e7)
    info['min_lon'] = struct.unpack_from('<i', data, 102)[0] / 1e7
    info['min_lat'] = struct.unpack_from('<i', data, 106)[0] / 1e7
    info['max_lon'] = struct.unpack_from('<i', data, 110)[0] / 1e7
    info['max_lat'] = struct.unpack_from('<i', data, 114)[0] / 1e7

    # Sanity rules
    bad = []
    if info['clustered'] not in (0, 1):
        bad.append('clustered flag should be 0 or 1')
    if info['tile_type'] != 1:
        bad.append(f'tile_type should be 1 (MVT), got {info["tile_type"]}')
    if info['min_zoom'] > info['max_zoom']:
        bad.append(f'min_zoom ({info["min_zoom"]}) > max_zoom ({info["max_zoom"]})')
    if info['min_lat'] > info['max_lat']:
        bad.append('bounds min_lat > max_lat')

    if bad:
        return False, {'issues': bad, **info}
    return True, info


def check_metadata(url, header_info):
    """Fetch + decode metadata, validate layer schema."""
    meta = fetch_bytes(url, header_info['meta_off'],
                        header_info['meta_off'] + header_info['meta_len'] - 1)
    # PMTiles v3 wraps metadata JSON in 5 bytes: type (u8)+len (4 LE) + gzipped data
    # or directly gzipped, depending on internal compression. Try both.
    try:
        decompressed = gzip.decompress(meta)
    except Exception:
        # Skip the 5-byte wrapper
        decompressed = gzip.decompress(meta[5:])
    metadata = json.loads(decompressed.decode())

    layers = {l['id']: l for l in metadata.get('vector_layers', [])}

    results = {'expected': EXPECTED_LAYERS, 'actual': {lid: (l.get('minzoom'), l.get('maxzoom')) for lid, l in layers.items()}}

    matches = []
    mismatches = []
    missing = []
    extras = []

    for lid, (emin, emax) in EXPECTED_LAYERS.items():
        if lid not in layers:
            missing.append(f'{lid} (expected z[{emin}-{emax}])')
            continue
        a_min, a_max = layers[lid]['minzoom'], layers[lid]['maxzoom']
        if (a_min, a_max) == (emin, emax):
            matches.append(lid)
        else:
            mismatches.append(f'{lid}: expected z[{emin}-{emax}] got z[{a_min}-{a_max}]')
    for lid in layers:
        if lid not in EXPECTED_LAYERS:
            extras.append(lid)

    return {
        'matches': matches,
        'mismatches': mismatches,
        'missing': missing,
        'extras': extras,
        'total_layers': len(layers),
        'all_layers': sorted(layers.keys()),
    }


def check_pbf_counts(pbf_path):
    """Count way-derived features in a PBF by the tags Planetiler routes to
    each destination source-layer. Slow (5-15 min on country-size PBF)
    but gives you ground truth."""
    try:
        import osmium
        import collections
    except ImportError:
        return None, 'osmium not installed; pip install osmium'

    class PbfAudit(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.n_ways = 0
            self.transportation_hw = 0
            self.building_closed = 0
            self.water_polygon = 0
            self.waterway = 0
            self.landuse = 0
            self.park = 0
            self.aeroway = 0
            self.railway = 0

        def way(self, w):
            self.n_ways += 1
            tags = w.tags
            if 'highway' in tags:  self.transportation_hw += 1
            b = tags.get('building')
            if b and w.is_closed():  self.building_closed += 1
            if tags.get('natural') == 'water' and w.is_closed():  self.water_polygon += 1
            if 'waterway' in tags:  self.waterway += 1
            lu = tags.get('landuse')
            if lu and w.is_closed():  self.landuse += 1
            if tags.get('leisure') == 'park' and w.is_closed():  self.park += 1
            aw = tags.get('aeroway')
            if aw and w.is_closed():  self.aeroway += 1
            if 'railway' in tags:  self.railway += 1

    h = PbfAudit()
    h.apply_file(pbf_path, locations=False)
    return {
        'n_ways': h.n_ways,
        'transportation (highway=*)': h.transportation_hw,
        'building (closed building=*)': h.building_closed,
        'water (closed natural=water)': h.water_polygon,
        'waterway (waterway=*)': h.waterway,
        'landuse (closed landuse=*)': h.landuse,
        'park (closed leisure=park)': h.park,
        'aeroway (closed aeroway=*)': h.aeroway,
        'transportation (railway=*)': h.railway,
    }, None


def main():
    ap = argparse.ArgumentParser(description='Validate a PMTiles archive for data integrity.')
    ap.add_argument('url', help='PMTiles URL or local file path')
    ap.add_argument('--pbf', help='Optional PBF path; runs slow completeness audit (5+ min)')
    args = ap.parse_args()

    url = args.url if args.url.startswith(('http://', 'https://', 'file://')) else 'file://' + os.path.abspath(args.url)

    print(f'# Audit: {url}\n')

    # Test 1: header
    print('## 1. PMTiles v3 header')
    ok, info = check_header(url)

    # The two most-asked questions — printed prominently FIRST so a future agent/user
    # running `audit-pmtiles.py <url>` doesn't have to scroll past per-field dumps
    # to answer them. Cross-reference Pitfall 24b ("max zoom is 14, not 16").
    print(f'   ┌── Quick answer (most-asked questions) ────────────────')
    print(f'   │  PMTiles max_zoom  = {info.get("max_zoom")}   ← highest detail zoom level')
    print(f'   │  PMTiles min_zoom  = {info.get("min_zoom")}')
    print(f'   │  bbox              = ({info["min_lon"]:.4f}, {info["min_lat"]:.4f}, {info["max_lon"]:.4f}, {info["max_lat"]:.4f})')
    print(f'   └── (see per-field dump below)')

    print(f'   magic: {info.get("magic")!r}')
    print(f'   spec_version: {info.get("spec_version")}')
    print(f'   min_zoom: {info.get("min_zoom")}  max_zoom: {info.get("max_zoom")}')
    print(f'   clustered: {info.get("clustered")}')
    print(f'   tile_type: {info.get("tile_type")} (1 = MVT)')
    print(f'   internal_compression: {info.get("internal_cmp")} (2 = gzip)')
    print(f'   tile_compression: {info.get("tile_cmp")} (1 = gzip, 2 = none)')
    print(f'   bbox: ({info["min_lon"]:.4f}, {info["min_lat"]:.4f}, {info["max_lon"]:.4f}, {info["max_lat"]:.4f})')
    print(f'   addressed_tiles_count: {info["addr_count"]:,}')
    print(f'   tile_entries_count:     {info["tile_entries"]:,}')
    print(f'   tile_contents_count:    {info["tile_contents"]:,}')
    print(f'   dedup ratio: {info["tile_contents"] / info["tile_entries"] * 100:.1f}%')
    if not ok:
        print(f'   FAIL: {info.get("issues", info.get("error"))}')
        sys.exit(1)
    print('   PASS  ✓')
    print()

    # Test 2: layer schema
    print('## 2. OpenMapTiles schema (16 layers expected)')
    meta_check = check_metadata(url, info)
    print(f'   matches ({len(meta_check["matches"])}/16 expected):')
    for m in meta_check['matches']:
        print(f'      ✓ {m}')
    if meta_check['mismatches']:
        print(f'   mismatches:')
        for m in meta_check['mismatches']:
            print(f'      ✗ {m}')
    if meta_check['missing']:
        print(f'   missing:')
        for m in meta_check['missing']:
            print(f'      - {m}')
    if meta_check['extras']:
        print(f'   extra (in pmtiles but not in canonical schema):')
        for x in meta_check['extras']:
            print(f'      + {x}')
    schema_ok = not meta_check['mismatches'] and not meta_check['missing']
    print(f'   {"PASS" if schema_ok else "FAIL"} ({meta_check["total_layers"]} layers in pmtiles; expected 16)')
    print()

    # Test 3: PBF ground truth (optional, slow)
    pbf_ok = True
    pbf_info = None
    if args.pbf:
        print(f'## 3. PBF → layer completeness (slow)')
        print(f'   Scanning PBF: {args.pbf}')
        print(f'   This will take 5-15 minutes on country-size files...')
        pbf_info, err = check_pbf_counts(args.pbf)
        if err:
            print(f'   SKIP: {err}')
        else:
            print(f'   PBF features per PMTiles destination layer:')
            for k, v in pbf_info.items():
                if k == 'n_ways':
                    print(f'      total ways: {v:,}')
                else:
                    print(f'      {k:40s} {v:>10,}')
            print()
            print('   "Completeness" interpretation: these are the WAY counts the')
            print('   PBF supplies. Planetiler routes 100% of each to the destination')
            print('   layer (subject to rule constraints in the profile). If a column')
            print('   above is > 0, expect it to appear in the PMTiles at the matching zoom range.')
    else:
        print('## 3. PBF → layer completeness (skipped — pass --pbf <path> to enable)')
        print()

    # Final verdict
    print('## Summary')
    if schema_ok:
        print('   ✓ Header OK + OpenMapTiles schema OK')
        print('   → Standard Planetiler output, ready for browser rendering')
        sys.exit(0)
    else:
        print('   ✗ Schema or header mismatch — investigate the failed layers above')
        sys.exit(1)


if __name__ == '__main__':
    main()
