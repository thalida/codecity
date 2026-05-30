"""Tests for GET /api/commit?sha=<sha>."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

import pytest

from api import server as server_mod
from api.server import start_server

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURE = FIXTURES_DIR / "sample-repo"


class TestServeCommitDetail(unittest.TestCase):
    """Coverage for /api/commit — full commit message detail endpoint."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(self, redirect_cache_root, http_helpers, monkeypatch) -> None:
        self.cache_root = redirect_cache_root
        self._http = http_helpers
        self.monkeypatch = monkeypatch

    def setUp(self) -> None:
        super().setUp()
        self.server, self.port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"
        # Register the fixture as an allowed scan root so /api/commit can
        # resolve shas inside it. Mirrors what _serve_manifest does on a
        # successful scan; we call it directly to avoid a real HTTP round-trip.
        server_mod._State.allowed_roots.add(FIXTURE.resolve())

    def _get_commit(self, sha: str):
        status, body = self._http.request(self.port, f"/api/commit?sha={sha}")
        return status, body

    def test_returns_404_on_unknown_sha(self) -> None:
        status, body = self._get_commit("a" * 40)
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    def test_returns_400_on_invalid_sha_shape(self) -> None:
        for bad in ("", "xyz", "12", "Z" * 40, "g" * 7):
            with self.subTest(sha=bad):
                status, body = self._get_commit(bad)
                self.assertEqual(status, 400)
                self.assertIn("error", body)

    def test_returns_authors_subject_body_for_valid_sha(self) -> None:
        # The fixture's last commit is the multi-author "feat: co-authored work" one.
        sha = subprocess.check_output(
            ["git", "-C", str(FIXTURE), "rev-parse", "HEAD"], text=True,
        ).strip()
        status, body = self._get_commit(sha)
        self.assertEqual(status, 200)
        self.assertEqual(body["sha"], sha)
        self.assertEqual(
            body["authors"],
            [
                "Test Fixture Bot",
                "Pair Programmer",
                "Reviewer Person",
                "emailonly-bot",
            ],
        )
        self.assertEqual(body["date"], "2024-05-15")
        self.assertEqual(body["subject"], "feat: co-authored work")
        # Multi-line body
        self.assertIn("team effort", body["body"])
        # No email in the structured author list (privacy). The raw body
        # may still contain the original trailer lines as written by git;
        # only the parsed identities are sanitized.
        self.assertNotIn("@", json.dumps(body["authors"]))

    def test_short_sha_resolves(self) -> None:
        full_sha = subprocess.check_output(
            ["git", "-C", str(FIXTURE), "rev-parse", "HEAD"], text=True,
        ).strip()
        short = full_sha[:7]
        status, body = self._get_commit(short)
        self.assertEqual(status, 200)
        self.assertEqual(body["sha"], full_sha)

    def test_commit_unaffected_by_local_gate_when_no_roots_registered(self) -> None:
        """/api/commit looks up shas across already-registered scan roots.
        The local-repo gate doesn't change /api/commit's behavior on its
        own — this test guards against accidentally adding a stray
        local-gate check on the commit path."""
        from http import HTTPStatus

        self.monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
        # No roots registered yet → expect 404 (no scan root) not 403.
        # The local-repo gate is orthogonal to commit-detail lookup.
        status, body, _ = self._http.get(
            self.base + "/api/commit?sha=abcdef0123456789",
        )
        self.assertEqual(status, HTTPStatus.NOT_FOUND)


if __name__ == "__main__":
    unittest.main()
