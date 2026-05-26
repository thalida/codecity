"""Tests for DELETE /api/manifest/cache (split from test_server.py)."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api.server import start_server


class ManifestCacheDeleteTests(unittest.TestCase):
    """DELETE /api/manifest/cache wipes every cached manifest for a
    given source. Used by the frontend's recents-remove flow."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(
        self, redirect_cache_root, init_git_repo, http_helpers,
    ) -> None:
        self.cache_root = redirect_cache_root
        self._init_git_repo = init_git_repo
        self._http = http_helpers

    def setUp(self) -> None:
        super().setUp()
        self.server, self.server_port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)

    def test_clears_cache_for_local_source(self) -> None:
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            (Path(td) / "a.py").write_text("x = 1\n")
            # Warm the cache by hitting /api/manifest once.
            self._http.request_stream(self.server_port, f"/api/manifest?src={td}")
            manifests_dir = self.cache_root / "manifests"
            self.assertEqual(len(list(manifests_dir.iterdir())), 1)

            # DELETE the cache for this source.
            url = (
                f"http://127.0.0.1:{self.server_port}/api/manifest/cache"
                f"?src={td}"
            )
            status, body = self._http.delete(url)
            self.assertEqual(status, 200)
            self.assertEqual(body, {"deleted": 1})
            self.assertEqual(list(manifests_dir.iterdir()), [])

    def test_missing_src_returns_400(self) -> None:
        url = f"http://127.0.0.1:{self.server_port}/api/manifest/cache"
        status, body = self._http.delete(url)
        self.assertEqual(status, 400)
        self.assertIn("missing", body["error"])

    def test_invalid_src_returns_400(self) -> None:
        url = (
            f"http://127.0.0.1:{self.server_port}/api/manifest/cache"
            f"?src=neither-a-path-nor-a-url"
        )
        status, body = self._http.delete(url)
        self.assertEqual(status, 400)
        self.assertIn("unrecognized", body["error"])

    def test_no_cache_entries_returns_zero(self) -> None:
        # Path was never scanned — DELETE is a no-op success.
        with TemporaryDirectory() as td:
            url = (
                f"http://127.0.0.1:{self.server_port}/api/manifest/cache"
                f"?src={td}"
            )
            status, body = self._http.delete(url)
            self.assertEqual(status, 200)
            self.assertEqual(body, {"deleted": 0})

    def test_unknown_delete_route_returns_404(self) -> None:
        url = f"http://127.0.0.1:{self.server_port}/api/nope"
        status, body = self._http.delete(url)
        self.assertEqual(status, 404)
        self.assertIn("unknown api route", body["error"])


if __name__ == "__main__":
    unittest.main()
