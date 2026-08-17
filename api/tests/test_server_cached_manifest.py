"""TestClient coverage for /api/manifest/cached — the landing backdrop's read.

The contract that matters: it serves whatever is on disk and NEVER scans, so a
repo edited since its last scan still answers, and one never scanned 404s
instead of walking the filesystem."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.cache import cache_save_manifest
from api.tests.conftest import final_manifest


def _git(*a: str, cwd: Path) -> None:
    subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    p = tmp_path / "repo"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "f.txt").write_text("x\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c", cwd=p)
    return p


@pytest.fixture()
def client(tmp_path: Path, redirect_cache_root) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def _warm_cache(repo: Path) -> str:
    """Scan once and store it, the way a real open would."""
    manifest = final_manifest(str(repo), use_cache=False)
    cache_save_manifest(repo, manifest.content_signature, manifest)
    return manifest.content_signature


def test_missing_src_is_rejected(client: TestClient) -> None:
    assert client.get("/api/manifest/cached").status_code in (400, 422)


def test_unknown_source_404s_rather_than_scanning(
    client: TestClient, tmp_path: Path
) -> None:
    r = client.get("/api/manifest/cached", params={"src": str(tmp_path / "nope")})
    assert r.status_code == 404


def test_never_scanned_repo_404s(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    r = client.get("/api/manifest/cached", params={"src": str(repo)})
    assert r.status_code == 404


def test_serves_the_cached_manifest(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    signature = _warm_cache(repo)
    r = client.get("/api/manifest/cached", params={"src": str(repo)})
    assert r.status_code == 200
    assert r.json()["content_signature"] == signature


def test_serves_a_stale_manifest_after_the_repo_changes(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    """The point of the endpoint: an edited repo still has wallpaper to show."""
    stale = _warm_cache(repo)
    (repo / "f.txt").write_text("edited, so the content signature moves\n")
    fresh = final_manifest(str(repo), use_cache=False).content_signature
    assert fresh != stale, "fixture failed to change the repo"

    r = client.get("/api/manifest/cached", params={"src": str(repo)})
    assert r.status_code == 200
    assert r.json()["content_signature"] == stale


def test_serves_the_newest_of_several_cached_scans(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    _warm_cache(repo)
    (repo / "f.txt").write_text("second state\n")
    newest = _warm_cache(repo)

    r = client.get("/api/manifest/cached", params={"src": str(repo)})
    assert r.status_code == 200
    assert r.json()["content_signature"] == newest
