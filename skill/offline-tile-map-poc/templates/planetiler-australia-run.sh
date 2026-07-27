#!/usr/bin/env bash
# Build a working Australia PMTiles with Planetiler — exact recipe from the
# 2026-07-18 session that finally succeeded end-to-end.
#
# Expected runtime: ~45 minutes total (~30 min aux shapefile download, ~7 min
# PBF process).  Requires Java 11+ on PATH (Planetiler itself ships its
# dependencies; this script just verifies it's there).
#
# Inputs:
#   - $PBF  : path to Geofabrik Australia PBF (e.g. data/australia-260404.osm.pbf)
#   - $OUT  : output path for the .pmtiles
#
# Both default to the 2026-07-18 session paths so you can `./build.sh` and it
# runs out of the box.

set -euo pipefail

# Resolve the script directory so paths work regardless of caller CWD
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PBF="${PBF:-$PROJECT_DIR/data/australia-260404.osm.pbf}"
OUT="${OUT:-$PROJECT_DIR/demo/australia.pmtiles}"
JAR="${JAR:-$PROJECT_DIR/tools/planetiler.jar}"
JAVA="${JAVA:-/c/Program Files (x86)/jdk/bin/java.exe}"

if [[ ! -f "$PBF" ]]; then
    echo "ERROR: PBF not found at $PBF" >&2
    exit 1
fi
if [[ ! -f "$JAR" ]]; then
    echo "ERROR: planetiler.jar not found at $JAR  —  download from" >&2
    echo "  https://github.com/onthegomap/planetiler/releases/download/v0.10.2/planetiler.jar" >&2
    exit 1
fi
if [[ ! -x "$JAVA" ]]; then
    # Try a few common JRE locations before giving up
    for j in /usr/bin/java /usr/lib/jvm/*/bin/java "$(command -v java)"; do
        [[ -x "$j" ]] && JAVA="$j" && break
    done
fi

echo "[build] planetiler jar:  $JAR"
echo "[build] input  PBF:       $PBF"
echo "[build] output PMT:      $OUT"
echo "[build] java:            $JAVA"
echo

# On the first run Planetiler downloads ~1.4 GB of auxiliary shapefiles
# (natural_earth 434 MB, lake_centerline 80 MB, water_polygons 920 MB) into
# data/sources/.  After that, they're cached and --download=true skips them.
#
# --area=Australia sets the bounding box.  --force overwrites output even if
# it's a stale partial download.  -Xmx6g is enough for an 887 MB country
# PBF; bump to 12g for planet-scale (~100 GB).
"$JAVA" -Xmx6g -jar "$JAR" \
    --area=Australia \
    --download=true \
    --force \
    --osm_path="$PBF" \
    --output="$OUT"

echo
echo "[build] done.  Verify with:"
echo "  ls -la \"$OUT\"     # should be ~1.24 GB"
echo "  python -c \"import struct; h=open('$OUT','rb').read(127); print('OK' if h[:7]==b'PMTiles' else 'FAIL')\""
echo "  Then load demo/index.html in Chrome and click the Australia button."
