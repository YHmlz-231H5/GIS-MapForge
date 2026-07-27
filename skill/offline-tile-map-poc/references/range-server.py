"""
Minimal HTTP server with HTTP Range Request support.

WHY THIS EXISTS (the lesson this skill exists to prevent):
    PMTiles (protomaps-js) fetches individual tiles and metadata from a .pmtiles
    archive by issuing HTTP Range requests ("bytes=0-127", "bytes=128-255", ...).
    Python's built-in http.server.SimpleHTTPRequestHandler does NOT implement
    Range, so the browser would get full-file responses (slow, breaks RangeAware
    parsing, fails CORS for fetch).

    This handler:
      - Serves files from the directory it lives in.
      - Honors Range: bytes=a-b and replies with 206 Partial Content.
      - Falls back to 200 OK when no Range header is present.
      - Sends CORS headers (Access-Control-Allow-Origin: *) so even cross-origin
        debug clients can fetch the .pmtiles file.
      - Returns 204 for /favicon.ico (Chrome auto-requests this; otherwise you
        get a 404 console error that violates the typical PoC "no 404" requirement).
      - Sets correct Content-Type for .pbf / .json / .pmtiles / .js / .css.

Run:
    python server.py [PORT]   (default 8765)
"""
import sys
import os
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))


class RangeHTTPRequestHandler(BaseHTTPRequestHandler):
    # Quieter logs.
    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        # Strip query, normalise path, prevent traversal.
        path = self.path.split("?", 1)[0]
        rel = path.lstrip("/")

        # Silently satisfy Chrome's automatic /favicon.ico request so the
        # Network/Console panels stay clean — the demo has no real favicon.
        if rel == "favicon.ico":
            self.send_response(204)
            self._send_cors()
            self.end_headers()
            return

        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            self.send_error(404, "Not Found")
            return

        file_size = os.path.getsize(full)
        ctype, _ = mimetypes.guess_type(full)
        if ctype is None:
            ctype = "application/octet-stream"

        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes="):
            try:
                spec = range_header[len("bytes="):]
                start_s, end_s = spec.split("-", 1)
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else file_size - 1
                if end >= file_size:
                    end = file_size - 1
                if start > end or start < 0:
                    raise ValueError("invalid range")
                length = end - start + 1

                self.send_response(206)
                self.send_header("Content-Type", ctype)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(length))
                self._send_cors()
                self.end_headers()

                with open(full, "rb") as f:
                    f.seek(start)
                    remaining = length
                    chunk = 64 * 1024
                    while remaining > 0:
                        buf = f.read(min(chunk, remaining))
                        if not buf:
                            break
                        self.wfile.write(buf)
                        remaining -= len(buf)
            except Exception as e:
                self.send_error(416, f"Range Not Satisfiable: {e}")
        else:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(file_size))
            self._send_cors()
            self.end_headers()
            with open(full, "rb") as f:
                while True:
                    buf = f.read(64 * 1024)
                    if not buf:
                        break
                    self.wfile.write(buf)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"[range-server] root={ROOT}")
    print(f"[range-server] listening on http://127.0.0.1:{port}")
    HTTPServer(("127.0.0.1", port), RangeHTTPRequestHandler).serve_forever()


if __name__ == "__main__":
    main()