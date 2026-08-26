"""TestClient coverage for /api/commit (sha validation + lookup)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


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
    # --author outranks the GIT_AUTHOR_NAME the test container sets, which
    # would otherwise beat the user.name config above.
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


def test_commit_invalid_sha_400(client: TestClient, repo: Path) -> None:
    r = client.get("/api/commit", params={"src": str(repo), "sha": "zzz"})
    assert r.status_code == 400


def test_commit_from_a_source_that_is_not_on_disk_404s(
    client: TestClient, tmp_path: Path
) -> None:
    r = client.get(
        "/api/commit",
        params={"src": str(tmp_path / "never-scanned"), "sha": "abc1234"},
    )
    assert r.status_code == 404


def test_commit_sha_not_in_this_repo_404s(client: TestClient, repo: Path) -> None:
    r = client.get("/api/commit", params={"src": str(repo), "sha": "abc1234"})
    assert r.status_code == 404


def test_commit_lookup_ok(client: TestClient, repo: Path) -> None:
    sha = _git("rev-parse", "HEAD", cwd=repo)
    r = client.get("/api/commit", params={"src": str(repo), "sha": sha})
    assert r.status_code == 200
    body = r.json()
    assert body["sha"] == sha
    assert body["subject"] == "first commit"
    assert "Tester" in body["authors"]
