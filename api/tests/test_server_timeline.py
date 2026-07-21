"""TestClient coverage for GET /api/timeline (bundle assembly + cache)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


def _git(*a: str, cwd: Path) -> None:
    subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)


@pytest.fixture()
def client(tmp_path: Path, redirect_cache_root) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


@pytest.fixture()
def two_commit_repo(tmp_path: Path) -> Path:
    p = tmp_path / "repo"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "a.txt").write_text("hello\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c1", cwd=p)
    (p / "b.txt").write_text("world\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c2", cwd=p)
    return p


def test_timeline_missing_src_400(client: TestClient) -> None:
    assert client.get("/api/timeline").status_code in (400, 422)


def test_timeline_endpoint_returns_bundle(
    client: TestClient, two_commit_repo: Path, allow_local_repos
) -> None:
    resp = client.get("/api/timeline", params={"src": str(two_commit_repo)})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) >= {"commits", "unionManifest", "deltas", "blobLines", "note"}
    assert len(body["commits"]) == 2
    assert isinstance(body["deltas"], list)


def test_timeline_warm_cache_hit(
    client: TestClient, two_commit_repo: Path, allow_local_repos
) -> None:
    src = str(two_commit_repo)
    first = client.get("/api/timeline", params={"src": src}).json()
    second = client.get("/api/timeline", params={"src": src}).json()
    assert first == second


def test_timeline_bad_src_400(client: TestClient, tmp_path: Path) -> None:
    not_a_repo = tmp_path / "not-a-repo"
    not_a_repo.mkdir()
    resp = client.get("/api/timeline", params={"src": str(not_a_repo)})
    assert resp.status_code == 400
