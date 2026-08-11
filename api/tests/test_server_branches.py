"""TestClient coverage for GET /api/branches."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.git.clone import RepoNotFoundError


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def test_branches_happy_path(
    client: TestClient, make_fake_remote, tmp_path: Path
) -> None:
    bare, _ = make_fake_remote(tmp_path)
    r = client.get("/api/branches", params={"src": f"file://{bare}"})
    assert r.status_code == 200
    body = r.json()
    assert "main" in body["branches"]
    assert body["default"] == "main"


def test_branches_rejects_local_path(client: TestClient) -> None:
    r = client.get("/api/branches", params={"src": "/tmp/some/local/path"})
    assert r.status_code == 400


def test_branches_missing_src(client: TestClient) -> None:
    assert client.get("/api/branches").status_code == 422  # FastAPI required-query


def test_unreachable_repo_carries_the_code(client: TestClient, monkeypatch) -> None:
    """The branch lookup is the first request to touch a remote, so this is
    where a repo the server can't reach usually fails. The picker keys its
    remedy on the code, so a message-only 404 leaves the user with raw git
    stderr and no way forward."""

    def _boom(*a, **kw):
        raise RepoNotFoundError("repository not found at https://github.com/o/r")

    monkeypatch.setattr("api.routers.branches.list_remote_branches", _boom)
    r = client.get("/api/branches", params={"src": "https://github.com/o/r"})
    assert r.status_code == 404
    assert r.json()["code"] == "repo-not-found"
    # Never asserts privacy: a 404 to an anonymous caller is indistinguishable
    # from a typo.
    assert "private" not in r.json()["error"].lower()
