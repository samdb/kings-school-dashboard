import http.client
import json
import os
import tempfile
import threading
import unittest

from kingsdash import config
from kingsdash.server import BIND_HOST, make_server, valid_host
from kingsdash.service import Service
from tests.helpers import FakeClient


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.env = config.Env({"KINGSDASH_DATA_DIR": cls.tmp.name})
        # A secret-looking file in data/ that must never be served.
        with open(os.path.join(cls.tmp.name, "config.json"), "w") as fh:
            json.dump(config.default_config(), fh)
        cls.service = Service(cls.env, client=FakeClient([{"threads": []}], {}))
        cls.httpd = make_server(cls.env, cls.service, port=0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def request(self, method, path, body=None, headers=None, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": host or "127.0.0.1:%d" % self.port}
        h.update(headers or {})
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
            h["Content-Length"] = str(len(data))
        conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        for k, v in h.items():
            conn.putheader(k, v)
        conn.endheaders(data)
        resp = conn.getresponse()
        payload = resp.read()
        conn.close()
        return resp, payload

    def origin(self):
        return {"Origin": "http://127.0.0.1:%d" % self.port}

    def test_binds_loopback_only(self):
        self.assertEqual(BIND_HOST, "127.0.0.1")
        self.assertEqual(self.httpd.server_address[0], "127.0.0.1")

    def test_index_and_security_headers(self):
        resp, body = self.request("GET", "/")
        self.assertEqual(resp.status, 200)
        self.assertIn(b"King's School Rochester", body)
        csp = resp.getheader("Content-Security-Policy")
        self.assertIn("default-src 'none'", csp)
        self.assertIn("script-src 'self'", csp)
        self.assertEqual(resp.getheader("X-Content-Type-Options"), "nosniff")
        self.assertNotIn(b"http://", body.replace(b"http://www.w3.org", b""))  # no external assets

    def test_static_assets_have_no_external_urls(self):
        for path in ("/static/app.js", "/static/app.css"):
            resp, body = self.request("GET", path)
            self.assertEqual(resp.status, 200, path)
            self.assertNotIn(b"fonts.googleapis", body)
            self.assertNotIn(b"innerHTML", body)

    def test_path_traversal_and_data_dir_not_served(self):
        for path in ["/data/config.json", "/static/../data/config.json", "/static/%2e%2e/data/config.json",
                     "/../kingsdash/server.py", "/static/", "/static/app.js/../../data/state.json",
                     "/kingsdash/config.py", "//etc/passwd", "/README.md", "/.gitignore"]:
            with self.subTest(path=path):
                resp, body = self.request("GET", path)
                self.assertEqual(resp.status, 404)
                self.assertNotIn(b"child_first_name", body)

    def test_query_strings_do_not_bypass_whitelist(self):
        resp, _ = self.request("GET", "/static/app.js?x=../../data/config.json")
        self.assertEqual(resp.status, 200)

    def test_host_header_validation(self):
        for host in ["evil.example", "127.0.0.1.evil.example:80", "localhost.evil:8765", ""]:
            with self.subTest(host=host):
                resp, _ = self.request("GET", "/api/feed", host=host or " ")
                self.assertEqual(resp.status, 421)
        resp, _ = self.request("GET", "/api/feed", host="localhost:9999")  # SSH tunnel port
        self.assertEqual(resp.status, 200)
        self.assertTrue(valid_host("[::1]:8765"))
        self.assertFalse(valid_host("localhost:99999"))

    def test_mutations_require_same_origin(self):
        body = {"key": "abc", "changes": {"saved": True}}
        resp, _ = self.request("POST", "/api/marks", body)
        self.assertEqual(resp.status, 403, "missing Origin")
        resp, _ = self.request("POST", "/api/marks", body, {"Origin": "http://evil.example"})
        self.assertEqual(resp.status, 403)
        resp, _ = self.request("POST", "/api/marks", body, {"Origin": "null"})
        self.assertEqual(resp.status, 403)
        resp, _ = self.request("POST", "/api/marks", body,
                               dict(self.origin(), **{"Sec-Fetch-Site": "cross-site"}))
        self.assertEqual(resp.status, 403)
        resp, _ = self.request("POST", "/api/marks", body, self.origin())
        self.assertEqual(resp.status, 200)

    def test_form_posts_rejected(self):
        resp, _ = self.request("POST", "/api/settings", b"demo_mode=true",
                               dict(self.origin(), **{"Content-Type": "application/x-www-form-urlencoded"}))
        self.assertEqual(resp.status, 415)

    def test_json_type_and_size_validation(self):
        resp, _ = self.request("POST", "/api/marks", b"{bad json", self.origin())
        self.assertEqual(resp.status, 400)
        resp, _ = self.request("POST", "/api/marks", [1, 2], self.origin())
        self.assertEqual(resp.status, 400)
        resp, _ = self.request("POST", "/api/marks", {"key": "a", "changes": {"done": "yes"}}, self.origin())
        self.assertEqual(resp.status, 400)
        resp, _ = self.request("POST", "/api/settings", {"refresh_minutes": "30"}, self.origin())
        self.assertEqual(resp.status, 400)
        resp, _ = self.request("POST", "/api/settings", {"query": "x" * 40000}, self.origin())
        self.assertEqual(resp.status, 413)

    def test_unknown_routes_and_methods(self):
        resp, _ = self.request("POST", "/api/anything", {}, self.origin())
        self.assertEqual(resp.status, 404)
        resp, _ = self.request("DELETE", "/api/marks")
        self.assertEqual(resp.status, 405)
        resp, _ = self.request("PUT", "/api/settings", {})
        self.assertEqual(resp.status, 405)

    def test_settings_round_trip_and_feed(self):
        cfg = config.default_config()
        cfg["profile"].update(child_first_name="Robin", activities=["Chess Club"])
        resp, body = self.request("POST", "/api/settings", cfg, self.origin())
        self.assertEqual(resp.status, 200, body)
        resp, body = self.request("GET", "/api/settings")
        self.assertEqual(json.loads(body)["profile"]["child_first_name"], "Robin")
        resp, body = self.request("GET", "/api/feed")
        feed = json.loads(body)
        self.assertEqual(feed["connection"], "not_configured")
        self.assertEqual(feed["items"], [])
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")

    def test_refresh_endpoint(self):
        resp, body = self.request("POST", "/api/refresh", {}, self.origin())
        self.assertIn(resp.status, (202, 409))
        resp, _ = self.request("POST", "/api/refresh", {"extra": 1}, self.origin())
        self.assertEqual(resp.status, 400)


if __name__ == "__main__":
    unittest.main()
