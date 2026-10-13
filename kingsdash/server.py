"""Local-only HTTP server. Binds 127.0.0.1, validates Host and Origin, whitelists routes."""

import json
import logging
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import config as cfgmod
from .service import Service

log = logging.getLogger("kingsdash")
BIND_HOST = "127.0.0.1"
MAX_BODY = 32 * 1024
_HOST_RE = re.compile(r"^(\[::1\]|127\.0\.0\.1|localhost)(?::(\d{1,5}))?$", re.I)

# Fixed map: URL path -> (file inside static/, content type). Nothing else is ever served.
STATIC_ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/static/app.css": ("app.css", "text/css; charset=utf-8"),
    "/static/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/static/favicon.svg": ("favicon.svg", "image/svg+xml"),
}

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; "
       "frame-ancestors 'none'")


def valid_host(value):
    m = _HOST_RE.match((value or "").strip())
    if not m:
        return False
    port = m.group(2)
    return port is None or 0 < int(port) < 65536


class Handler(BaseHTTPRequestHandler):
    server_version = "KingsDash"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    @property
    def service(self):
        return self.server.service

    def log_message(self, fmt, *args):  # keep request logs terse; never log bodies
        log.info("%s %s", self.command, self.path.split("?", 1)[0])

    # ---------- responses ----------
    def _headers(self, status, ctype, length, cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.end_headers()

    def _json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(body))
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status, message):
        # An unread request body must never be parsed as a follow-up request.
        self.close_connection = True
        self._json(status, {"error": message})

    # ---------- guards ----------
    def _check_host(self):
        if not valid_host(self.headers.get("Host")):
            self._error(421, "This dashboard only answers on localhost.")
            return False
        return True

    def _check_origin(self):
        """Mutations must come from this page: same Origin as Host, JSON body."""
        origin = self.headers.get("Origin")
        host = (self.headers.get("Host") or "").strip()
        if not origin or origin.lower() != ("http://" + host).lower():
            self._error(403, "Cross-origin request refused.")
            return False
        site = self.headers.get("Sec-Fetch-Site")
        if site and site not in ("same-origin", "none"):
            self._error(403, "Cross-site request refused.")
            return False
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            self._error(415, "Expected application/json.")
            return False
        return True

    def _read_json(self):
        if self.headers.get("Transfer-Encoding"):
            self._error(411, "Chunked bodies are not accepted.")
            return None
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._error(411, "Content-Length required.")
            return None
        if length < 0 or length > MAX_BODY:
            self._error(413, "Request too large.")
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._error(400, "Body must be valid JSON.")
            return None

    # ---------- methods ----------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._check_host():
            return
        path = self.path.split("?", 1)[0]
        if path in STATIC_ROUTES:
            return self._static(*STATIC_ROUTES[path])
        if path == "/api/feed":
            return self._json(200, self.service.feed())
        if path == "/api/settings":
            return self._json(200, self.service.get_config())
        if path == "/api/status":
            feed_status = dict(self.service.status)
            return self._json(200, {"refresh": feed_status})
        return self._error(404, "Not found.")

    def do_POST(self):
        if not self._check_host() or not self._check_origin():
            return
        path = self.path.split("?", 1)[0]
        if path not in ("/api/refresh", "/api/settings", "/api/marks"):
            return self._error(404, "Not found.")
        body = self._read_json()
        if body is None:
            return
        if not isinstance(body, dict):
            return self._error(400, "Body must be a JSON object.")
        try:
            if path == "/api/refresh":
                if body:
                    return self._error(400, "Refresh takes no parameters.")
                started = self.service.start_refresh("manual")
                return self._json(202 if started else 409,
                                  {"started": started, "refresh": dict(self.service.status)})
            if path == "/api/settings":
                return self._json(200, self.service.save_config(body))
            if path == "/api/marks":
                if set(body) - {"key", "changes"}:
                    return self._error(400, "Unexpected fields.")
                mark = self.service.set_mark(body.get("key"), body.get("changes"))
                return self._json(200, {"key": body.get("key"), "mark": mark})
        except cfgmod.ValidationError as exc:
            return self._error(400, str(exc))

    def _method_not_allowed(self):
        if not self._check_host():
            return
        self._error(405, "Method not allowed.")

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _method_not_allowed

    def _static(self, filename, ctype):
        path = os.path.join(cfgmod.STATIC_DIR, filename)
        try:
            with open(path, "rb") as fh:
                body = fh.read()
        except OSError:
            return self._error(404, "Not found.")
        self._headers(200, ctype, len(body), cache="no-cache")
        if self.command != "HEAD":
            self.wfile.write(body)


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, port, service):
        super().__init__((BIND_HOST, port), Handler)
        self.service = service


def make_server(env, service=None, port=None):
    service = service or Service(env)
    return DashboardServer(env.port if port is None else port, service)


def main(argv=None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.umask(0o077)
    env = cfgmod.Env()
    httpd = make_server(env)
    httpd.service.start_scheduler()
    host, port = httpd.server_address[:2]
    print("King's School dashboard running at http://%s:%d/ (local only; Ctrl+C to stop)" % (host, port),
          file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.service.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
