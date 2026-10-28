"""Tests for the desktop launcher (sel_trip_analyzer.py): local server, file hand-off, updater.

Run:  python -m unittest discover -s tests -v       (the analysis itself is tested in tests/*.test.js)
Needs dist/SEL_Trip_Analyzer.html or web/ (it builds the page).
"""
import base64
import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
os.environ["LOCALAPPDATA"] = tempfile.mkdtemp()

import sel_trip_analyzer as app  # noqa: E402

SAMPLES = os.path.join(ROOT, "sample_files")


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = app.App(app.find_page())
        cls.srv = app.start_server(cls.app, 0)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def call(self, path, body=None, token=True, host=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Token"] = self.app.token
        if host:
            headers["Host"] = host
        req = urllib.request.Request(self.base + path, headers=headers, method="POST" if body is not None else "GET",
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()

    def test_page_has_bridge_and_all_scripts(self):
        status, html = self.call("/", token=False)
        html = html.decode()
        self.assertEqual(status, 200)
        for marker in ("window.SEL_DESKTOP", self.app.token, "SELWaveUI", "SELWeather", "SELDocx"):
            self.assertIn(marker, html)

    def test_api_needs_token_and_local_host(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.call("/api/info", token=False)
        self.assertEqual(e.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as e:   # DNS-rebinding style request
            self.call("/", token=False, host="evil.example")
        self.assertEqual(e.exception.code, 403)
        self.assertEqual(json.loads(self.call("/api/info")[1])["version"], app.VERSION)

    def test_files_queue_and_handoff(self):
        n = self.app.queue([SAMPLES])
        self.assertGreaterEqual(n, 10)
        files = json.loads(self.call("/api/pending")[1])["files"]
        names = {f["name"] for f in files}
        self.assertIn("Feeder3_CG_51G.cfg", names)
        self.assertNotIn("README.txt", names)
        self.assertEqual(json.loads(self.call("/api/pending")[1])["files"], [])
        cev = os.path.join(SAMPLES, "Feeder12_AG_Zone1.cev")
        self.call("/api/handoff", {"paths": [cev]})
        f = json.loads(self.call("/api/pending")[1])["files"][0]
        with open(cev, "rb") as fh:
            self.assertEqual(base64.b64decode(f["b64"]), fh.read())

    def test_save_writes_file(self):
        if app.WIN:
            self.skipTest("opens a real Save dialog on Windows")
        os.environ["HOME"] = tempfile.mkdtemp()
        r = json.loads(self.call("/api/save", {"name": "x.txt", "b64": base64.b64encode(b"hello").decode()})[1])
        with open(r["saved"], "rb") as fh:
            self.assertEqual(fh.read(), b"hello")

    def test_only_https_links_open(self):
        opened = []
        orig = app.webbrowser.open
        app.webbrowser.open = opened.append
        try:
            self.call("/api/open-url", {"url": "file:///etc/passwd"})
            self.call("/api/open-url", {"url": "https://github.com/"})
        finally:
            app.webbrowser.open = orig
        self.assertEqual(opened, ["https://github.com/"])


class Updater(unittest.TestCase):
    def test_version_compare(self):
        self.assertGreater(app.version_tuple("v2.10.0"), app.version_tuple("2.9.9"))
        self.assertEqual(app.version_tuple("v2.0.0"), app.version_tuple("2.0.0"))

    def test_release_lookup(self):
        exe = b"MZ" + b"x" * 500
        rel = {"tag_name": "v99.0.0", "body": "notes", "html_url": "",
               "assets": [{"name": app.EXE_ASSET_NAME, "browser_download_url": "EXE",
                           "digest": "sha256:" + hashlib.sha256(exe).hexdigest()},
                          {"name": app.HTML_ASSET_NAME, "browser_download_url": "HTML"}]}

        class R(io.BytesIO):
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        orig = app._http_get
        app._http_get = lambda url, **k: R(json.dumps(rel).encode() if "api.github" in url else exe)
        try:
            info = app.check_for_update()
            self.assertEqual((info["version"], info["html_url"]), ("99.0.0", "HTML"))
            with tempfile.TemporaryDirectory() as d:
                self.assertEqual(app.download_file("EXE", os.path.join(d, "x.exe")), info["sha256"])
            rel["tag_name"] = "v" + app.VERSION
            self.assertIsNone(app.check_for_update())
        finally:
            app._http_get = orig


class Misc(unittest.TestCase):
    def test_expand_paths_order_and_filter(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "sub"))
            for p in ("b.cev", "a.rdb", "README.txt", "x.pdf", os.path.join("sub", "c.cfg")):
                open(os.path.join(d, p), "w").close()
            names = [os.path.relpath(p, d) for p in app.expand_paths([d])]
        self.assertEqual(names, ["a.rdb", "b.cev", os.path.join("sub", "c.cfg")])

    def test_selftest(self):
        app.selftest()


if __name__ == "__main__":
    unittest.main()
