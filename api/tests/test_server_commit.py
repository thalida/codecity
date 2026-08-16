"""TestClient coverage for /api/commit (sha validation + lookup)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.core.security import TRUST


def _git(*args: str, cwd: Path) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    p = tmp_path / "repo"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "Tester", cwd=p)
    (p / "f.txt").write_text("x")
    _git("add", ".", cwd=p)
    # Pin the author via --author so the commit's %an is deterministic: it
    # outranks a GIT_AUTHOR_NAME env var (the test container sets one), which
    # would otherwise win over the user.name config above.
    _git(
        "commit",
        "--author=Tester <a@b.c>",
        "-qm",
        "first commit\n\nbody line",
        cwd=p,
    )
    return p


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def test_commit_invalid_sha_400(client: TestClient) -> None:
    assert client.get("/api/commit", params={"sha": "zzz"}).status_code == 400


def test_commit_no_roots_404(client: TestClient) -> None:
    r = client.get("/api/commit", params={"sha": "abc1234"})
    assert r.status_code == 404


def test_commit_lookup_ok(client: TestClient, repo: Path) -> None:
    TRUST.register(repo)
    sha = _git("rev-parse", "HEAD", cwd=repo)
    r = client.get("/api/commit", params={"sha": sha})
    assert r.status_code == 200
    body = r.json()
    assert body["sha"] == sha
    assert body["subject"] == "first commit"
    assert "Tester" in body["authors"]
