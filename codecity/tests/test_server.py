"""Tests for the local HTTP server."""

from __future__ import annotations

import http.client
import json
import unittest
import urllib.error
import urllib.request
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory

from codecity.server import start_server


def _get(url: str) -> tuple[int, bytes, str]:
    """Issue a GET; return (status, body, content_type)."""
    try:
        resp = urllib.request.urlopen(url)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "")
    return resp.status, resp.read(), resp.headers.get("Content-Type", "")


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        static = Path(self.tmp.name)
        (static / "index.html").write_text("<html><body>hi</body></html>")
        (static / "assets").mkdir()
        (static / "assets" / "main.js").write_text("console.log('ok')")

        self.manifest = {"project": "demo", "tree": {"name": "demo"}}
        self.server, self.port, self.shutdown = start_server(
            self.manifest, port=0, static_dir=static
        )
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"

    def test_health_route(self) -> None:
        status, body, ctype = _get(self.base + "/api/health")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), {"ok": True})

    def test_manifest_route_returns_state(self) -> None:
        status, body, ctype = _get(self.base + "/api/manifest")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), self.manifest)

    def test_root_serves_index_html(self) -> None:
        status, body, ctype = _get(self.base + "/")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("text/html", ctype)
        self.assertIn(b"<body>hi</body>", body)

    def test_static_asset_with_correct_mime(self) -> None:
        status, body, ctype = _get(self.base + "/assets/main.js")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(
            ctype.startswith("text/javascript")
            or ctype.startswith("application/javascript")
        )
        self.assertEqual(body, b"console.log('ok')")

    def test_unknown_api_route_returns_404_json(self) -> None:
        status, body, ctype = _get(self.base + "/api/nope")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), {"error": "unknown api route"})

    def test_missing_static_returns_404(self) -> None:
        status, _, _ = _get(self.base + "/does-not-exist.html")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_path_traversal_rejected(self) -> None:
        # urllib normalizes ../ on the client side, so we go raw to make sure
        # the server itself rejects a crafted escape attempt.
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/../codecity/scan.py")
        resp = conn.getresponse()
        self.assertIn(resp.status, (HTTPStatus.FORBIDDEN, HTTPStatus.NOT_FOUND))


if __name__ == "__main__":
    unittest.main()
