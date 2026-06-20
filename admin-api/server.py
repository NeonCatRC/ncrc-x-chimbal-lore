#!/usr/bin/env python3
"""Admin write API for the archive overlay (annotations + review status).

Tiny stdlib HTTP server — no dependencies. Writes ONLY into the overlay dir
(mounted :rw); the content archive stays read-only. Meant to be bound to
127.0.0.1 on the host and reached over an SSH tunnel — never exposed publicly.

Endpoints:
  GET  /health                 -> {"ok": true}
  POST /annotations/<id>       body: JSON array  -> overlay/annotations/<id>.json
  POST /reviews                body: JSON object -> overlay/reviews.json
"""
import json
import os
import re
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OVERLAY = os.environ.get("OVERLAY_DIR", "/overlay")
TOKEN = os.environ.get("ADMIN_TOKEN", "")
ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")
PORT = int(os.environ.get("PORT", "8090"))
MAX_BODY = 5_000_000

ID_RE = re.compile(r"^[0-9]+$")
ANN_RE = re.compile(r"^/annotations/([^/]+)$")


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)   # mkstemp makes 0600 -> nginx (other) must be able to read
    os.replace(tmp, path)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _send(self, code, obj=None):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if obj is not None:
            self.wfile.write(json.dumps(obj).encode("utf-8"))

    def _auth_ok(self):
        return not TOKEN or self.headers.get("Authorization", "") == "Bearer " + TOKEN

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth_ok():
            return self._send(401, {"error": "unauthorized"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send(400, {"error": "bad length"})
        if n > MAX_BODY:
            return self._send(413, {"error": "too large"})
        try:
            data = json.loads(self.rfile.read(n) or b"null")
        except Exception:
            return self._send(400, {"error": "bad json"})

        m = ANN_RE.match(self.path)
        if m:
            aid = m.group(1)
            if not ID_RE.match(aid):
                return self._send(400, {"error": "bad id"})
            if not isinstance(data, list):
                return self._send(400, {"error": "expected array"})
            write_json(os.path.join(OVERLAY, "annotations", aid + ".json"), data)
            return self._send(200, {"ok": True, "count": len(data)})

        if self.path == "/reviews":
            if not isinstance(data, dict):
                return self._send(400, {"error": "expected object"})
            write_json(os.path.join(OVERLAY, "reviews.json"), data)
            return self._send(200, {"ok": True})

        self._send(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        pass  # quiet


if __name__ == "__main__":
    print(f"admin-api listening on :{PORT}, overlay={OVERLAY}, "
          f"auth={'on' if TOKEN else 'off'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
