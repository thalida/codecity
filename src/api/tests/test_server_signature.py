"""TestClient coverage for /api/manifest/signature + local-repo gating."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


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


@pytest.fixture()
def local_repo_with_subdir(tmp_path: Path) -> Path:
    """A committed repo with a `sub/` dir, for exercising ?exclude=sub."""
    p = tmp_path / "repo-with-subdir"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "f.txt").write_text("hello\nworld\n")
    sub = p / "sub"
    sub.mkdir()
    (sub / "g.txt").write_text("nested\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c", cwd=p)
    return p


def test_signature_missing_src_400(client: TestClient) -> None:
    assert client.get("/api/manifest/signature").status_code in (400, 422)


def test_signature_local_disabled_403(
    client: TestClient, repo: Path, monkeypatch
) -> None:
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    r = client.get("/api/manifest/signature", params={"src": str(repo)})
    assert r.status_code == 403


def test_signature_ok(client: TestClient, repo: Path, allow_local_repos) -> None:
    r = client.get("/api/manifest/signature", params={"src": str(repo)})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"scanned_at", "content_signature"}


def test_signature_endpoint_honors_exclude(
    client: TestClient, local_repo_with_subdir: Path, allow_local_repos
) -> None:
    src = str(local_repo_with_subdir)
    base = client.get("/api/manifest/signature", params={"src": src}).json()[
        "content_signature"
    ]
    excluded = client.get(
        "/api/manifest/signature", params={"src": src, "exclude": ["sub"]}
    ).json()["content_signature"]
    assert base != excluded
