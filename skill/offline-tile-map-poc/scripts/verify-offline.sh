#!/usr/bin/env bash
# Smoke-test a local PMTiles-aware HTTP server before opening Chrome.
# Usage:  ./scripts/verify-offline.sh [PORT] [PMTILES_FILENAME]
#
# Exits 0 on full pass, 1 on any failure. Designed to be the agent's last
# check before navigating Chrome — catches:
#   - 404 on the demo entry
#   - 404 / wrong type on vendor JS or CSS
#   - Server returning 200 (full file) instead of 206 (Range) for pmtiles
#   - Wrong Content-Range header
#   - Missing Accept-Ranges header
#
# This is a sanity check on the SERVER. It does not prove the browser can
# decode the tiles — only that the server hands out the bytes correctly.

set -u

PORT="${1:-8765}"
TILE="${2:-firenze.pmtiles}"
BASE="http://127.0.0.1:${PORT}"

PASS=0
FAIL=0

check() {
    local label="$1"
    local cond="$2"
    if [ "$cond" = "0" ]; then
        echo "  PASS  $label"
        PASS=$((PASS+1))
    else
        echo "  FAIL  $label"
        FAIL=$((FAIL+1))
    fi
}

echo "== Offline-tile-map server smoke test =="
echo "Base: $BASE"
echo "Tile: $TILE"
echo

# 1) Demo HTML
echo "[1] Demo HTML"
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/index.html")
[ "$status" = "200" ] && r=0 || r=1
check "GET /index.html → 200 (got $status)" $r

# 2) Vendor JS
echo "[2] Vendor assets"
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/vendor/maplibre-gl.js")
[ "$status" = "200" ] && r=0 || r=1
check "GET /vendor/maplibre-gl.js → 200 (got $status)" $r

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/vendor/pmtiles.js")
[ "$status" = "200" ] && r=0 || r=1
check "GET /vendor/pmtiles.js → 200 (got $status)" $r

# 3) PMTiles Range support — THE critical check
echo "[3] PMTiles Range support (must be 206, not 200)"
hdr=$(curl -s -o /dev/null -D - -H "Range: bytes=0-127" "$BASE/$TILE")
code=$(echo "$hdr" | head -1 | awk '{print $2}')
cr=$(echo "$hdr" | grep -i '^content-range:' | tr -d '\r')
ar=$(echo "$hdr" | grep -i '^accept-ranges:' | tr -d '\r')
[ "$code" = "206" ] && r=0 || r=1
check "Range 0-127 → 206 (got $code)" $r
echo "        $cr"
echo "        $ar"
echo "$cr" | grep -qE "bytes 0-127/" && r=0 || r=1
check "Content-Range header present and correct" $r
echo "$ar" | grep -qE "bytes" && r=0 || r=1
check "Accept-Ranges: bytes header present" $r

# 4) Mid-file Range
echo "[4] Mid-file Range"
hdr=$(curl -s -o /dev/null -D - -H "Range: bytes=1000-1099" "$BASE/$TILE")
code=$(echo "$hdr" | head -1 | awk '{print $2}')
cr=$(echo "$hdr" | grep -i '^content-range:' | tr -d '\r')
[ "$code" = "206" ] && r=0 || r=1
check "Range 1000-1099 → 206 (got $code)" $r
echo "        $cr"

# 5) No-Range request still works
echo "[5] Full GET (no Range header)"
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/$TILE")
[ "$status" = "200" ] && r=0 || r=1
check "GET /firenze.pmtiles (no Range) → 200 (got $status)" $r

# 6) Magic bytes match PMTiles spec
echo "[6] File integrity"
magic=$(curl -s -H "Range: bytes=0-6" "$BASE/$TILE" | head -c 7)
[ "$magic" = "PMTiles" ] && r=0 || r=1
check "Magic bytes = 'PMTiles' (got '$magic')" $r

ver=$(curl -s -H "Range: bytes=7-7" "$BASE/$TILE" | head -c 1)
# Version 3 = 0x03
ver_dec=$(printf '%d' "'$ver" 2>/dev/null || echo "0")
[ "$ver_dec" = "3" ] && r=0 || r=1
check "Spec version byte = 3 (got $ver_dec)" $r

echo
echo "== Result =="
echo "PASS: $PASS    FAIL: $FAIL"
[ "$FAIL" = "0" ] && exit 0 || exit 1