"""Tests for /api/config — the small endpoint the frontend reads at
boot to learn server-side feature flags (currently: whether local-repo
sources are permitted)."""

from __future__ import annotations

import json
import unittest
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api.server import start_server


class ServerConfigTests(unittest.TestCase):
    """Covers /api/config response shape across CODECITY_ALLOW_LOCAL_REPOS
    env-var states."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(self, http_helpers, monkeypatch, redirect_cache_root, init_git_repo) -> None:
        self._http = http_helpers
        self.monkeypatch = monkeypatch
        self.redirect_cache_root = redirect_cache_root
        self._init_git_repo = init_git_repo

    def setUp(self) -> None:
        super().setUp()
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        static = Path(self.tmp.name) / "static"
        static.mkdir()
        (static / "index.html").write_text("<html><body>hi</body></html>")

        self.server, self.port, self.shutdown = start_server(
            port=0, static_dir=static
        )
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"

    def test_config_env_unset_returns_false(self) -> None:
        self.monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
        status, body, ctype = self._http.get(self.base + "/api/config")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), {"allowLocalRepos": False})

    def test_config_env_one_returns_true(self) -> None:
        self.monkeypatch.setenv("CODECITY_ALLOW_LOCAL_REPOS", "1")
        status, body, _ = self._http.get(self.base + "/api/config")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(json.loads(body), {"allowLocalRepos": True})

    def test_config_env_true_returns_true(self) -> None:
        self.monkeypatch.setenv("CODECITY_ALLOW_LOCAL_REPOS", "true")
        _, body, _ = self._http.get(self.base + "/api/config")
        self.assertEqual(json.loads(body), {"allowLocalRepos": True})

    def test_config_env_zero_returns_false(self) -> None:
        self.monkeypatch.setenv("CODECITY_ALLOW_LOCAL_REPOS", "0")
        _, body, _ = self._http.get(self.base + "/api/config")
        self.assertEqual(json.loads(body), {"allowLocalRepos": False})


if __name__ == "__main__":
    unittest.main()
