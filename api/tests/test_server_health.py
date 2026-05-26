"""Tests for /api/health and general server routing (split from test_server.py)."""

from __future__ import annotations

import http.client
import json
import unittest
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api.server import start_server


class ServerHealthTests(unittest.TestCase):
    """Tests covering /api/health and the surrounding static/routing layer
    (root index, static MIME, unknown api routes, path traversal)."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(
        self, redirect_cache_root, init_git_repo, http_helpers,
    ) -> None:
        self.cache_root = redirect_cache_root
        self._init_git_repo = init_git_repo
        self._http = http_helpers

    def setUp(self) -> None:
        super().setUp()
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        static = Path(self.tmp.name) / "static"
        static.mkdir()
        (static / "index.html").write_text("<html><body>hi</body></html>")
        (static / "assets").mkdir()
        (static / "assets" / "main.js").write_text("console.log('ok')")

        # A small directory we can scan in the manifest test. Initialized
        # as a git repo because the API now requires every local scan
        # target to be inside a git working tree.
        self.project = Path(self.tmp.name) / "project"
        self.project.mkdir()
        self._init_git_repo(self.project)
        (self.project / "README.md").write_text("# demo\n")

        self.server, self.port, self.shutdown = start_server(port=0, static_dir=static)
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"

    def test_health_route(self) -> None:
        status, body, ctype = self._http.get(self.base + "/api/health")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), {"ok": True})

    def test_root_serves_index_html(self) -> None:
        status, body, ctype = self._http.get(self.base + "/")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("text/html", ctype)
        self.assertIn(b"<body>hi</body>", body)

    def test_static_asset_with_correct_mime(self) -> None:
        status, body, ctype = self._http.get(self.base + "/assets/main.js")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(
            ctype.startswith("text/javascript")
            or ctype.startswith("application/javascript")
        )
        self.assertEqual(body, b"console.log('ok')")

    def test_unknown_api_route_returns_404_json(self) -> None:
        status, body, ctype = self._http.get(self.base + "/api/nope")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), {"error": "unknown api route"})

    def test_missing_static_returns_404(self) -> None:
        status, _, _ = self._http.get(self.base + "/does-not-exist.html")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_path_traversal_rejected(self) -> None:
        # urllib normalizes ../ on the client side, so we go raw to make sure
        # the server itself rejects a crafted escape attempt.
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/../api/scan.py")
        resp = conn.getresponse()
        self.assertIn(resp.status, (HTTPStatus.FORBIDDEN, HTTPStatus.NOT_FOUND))

    def test_health_response_below_threshold_uncompressed(self) -> None:
        # /api/health body is ~15 bytes — below the 256-byte threshold.
        # Even with gzip in Accept-Encoding, response is not compressed.
        status, body, _, enc = self._http.get_with_headers(
            self.base + "/api/health",
            {"Accept-Encoding": "gzip"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        self.assertEqual(json.loads(body), {"ok": True})


if __name__ == "__main__":
    unittest.main()
