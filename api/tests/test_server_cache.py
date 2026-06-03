"""TestClient coverage for DELETE /api/manifest/cache."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.services.cache import cache_save_manifest
from api.services.scan import signature_tree


def _git(*a: str, cwd: Path) -> None:
    subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    p = tmp_path / "repo"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "f.txt").write_text("x")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c", cwd=p)
    return p


@pytest.fixture()
def client(tmp_path: Path, redirect_cache_root) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def test_cache_missing_src(client: TestClient) -> None:
    assert client.delete("/api/manifest/cache").status_code in (400, 422)


def test_cache_invalid_src_400(client: TestClient) -> None:
    r = client.delete("/api/manifest/cache", params={"src": "neither-path-nor-url"})
    assert r.status_code == 400


def test_cache_clears_warmed_local_source(client: TestClient, repo: Path) -> None:
    # Warm the cache directly via the service layer (no SSE stream yet).
    sig = signature_tree(str(repo), use_cache=False)["signature"]
    cache_save_manifest(repo.resolve(), sig, {"root": str(repo)})  # type: ignore[arg-type]
    r = client.delete("/api/manifest/cache", params={"src": str(repo)})
    assert r.status_code == 200
    assert r.json()["deleted"] >= 1


def test_cache_delete_not_gated_by_local_repos(client: TestClient, repo: Path, monkeypatch) -> None:
    # Cache-delete must work even when local repos are disabled.
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    r = client.delete("/api/manifest/cache", params={"src": str(repo)})
    assert r.status_code == 200
    assert "deleted" in r.json()
