"""Tests for /api/manifest/signature (split from test_server.py)."""

from __future__ import annotations

import json
import unittest
import urllib.parse
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api.server import start_server


class SignatureRouteTests(unittest.TestCase):
    """Coverage for /api/manifest/signature — the cheap-poll endpoint
    whose digest must match the full manifest's signature."""

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

        self.project = Path(self.tmp.name) / "project"
        self.project.mkdir()
        self._init_git_repo(self.project)
        (self.project / "README.md").write_text("# demo\n")

        self.server, self.port, self.shutdown = start_server(port=0, static_dir=static)
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"

    def test_signature_route_matches_manifest_signature(self) -> None:
        # The contract powering the cheap-poll: the signature endpoint
        # returns the same digest the full manifest would have produced.
        q = urllib.parse.urlencode({"src": str(self.project)})
        m_status, m_events = self._http.request_stream(self.port, f"/api/manifest?{q}")
        s_status, s_body, s_ctype = self._http.get(self.base + f"/api/manifest/signature?{q}")
        self.assertEqual(m_status, HTTPStatus.OK)
        self.assertEqual(s_status, HTTPStatus.OK)
        self.assertIn("application/json", s_ctype)
        manifest = next(e for e in m_events if e["phase"] == "final")["manifest"]
        sig = json.loads(s_body)
        self.assertEqual(sig["signature"], manifest["signature"])
        # Lean shape — no tree / repo fields on the signature endpoint.
        self.assertNotIn("tree", sig)
        self.assertNotIn("repo", sig)

    def test_signature_route_missing_query_returns_400(self) -> None:
        status, _, _ = self._http.get(self.base + "/api/manifest/signature")
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)

    def test_signature_route_nonexistent_path_returns_404(self) -> None:
        q = urllib.parse.urlencode({"src": str(self.project / "nope")})
        status, _, _ = self._http.get(self.base + f"/api/manifest/signature?{q}")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

if __name__ == "__main__":
    unittest.main()
