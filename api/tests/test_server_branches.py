"""TestClient coverage for GET /api/branches."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.git import clone as clone_mod
from api.git.clone import RepoNotFoundError


@pytest.fixture(autouse=True)
def _clear_ls_remote_cache():
    """The memo is module state, and a cached answer outliving its test would
    hide the very network call the next one is counting."""
    clone_mod._ls_remote_cache.clear()
    yield
    clone_mod._ls_remote_cache.clear()


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


def test_repeat_lookups_reach_the_remote_once(
    client: TestClient, tmp_path: Path
) -> None:
    """The picker re-resolves as the field is edited, and a reload asks again.
    Each miss is a git connection to the remote, which is what gets rate
    limited, so an answer this fresh is served from memory."""
    from unittest import mock

    src = "https://example.test/o/r"
    with mock.patch.object(
        clone_mod, "_ls_remote", return_value=(["main"], "main")
    ) as ls_remote:
        first = client.get("/api/branches", params={"src": src})
        second = client.get("/api/branches", params={"src": src})

    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    ls_remote.assert_called_once()


def test_a_failure_is_not_remembered(client: TestClient) -> None:
    """A cached refusal would outlive the outage behind it, and the picker would
    keep insisting a reachable repo is unreachable."""
    from unittest import mock

    src = "https://example.test/o/flaky"
    with mock.patch.object(
        clone_mod,
        "_ls_remote",
        side_effect=[RepoNotFoundError("nope"), (["main"], "main")],
    ) as ls_remote:
        assert client.get("/api/branches", params={"src": src}).status_code == 404
        recovered = client.get("/api/branches", params={"src": src})

    assert recovered.status_code == 200
    assert ls_remote.call_count == 2


def test_a_stale_answer_is_asked_again(client: TestClient, monkeypatch) -> None:
    """Held long enough to absorb a burst of typing, not long enough to hide a
    branch pushed a minute ago."""
    from unittest import mock

    src = "https://example.test/o/moving"
    monkeypatch.setattr(clone_mod, "_LS_REMOTE_TTL_S", 0.0)
    with mock.patch.object(
        clone_mod, "_ls_remote", return_value=(["main"], "main")
    ) as ls_remote:
        client.get("/api/branches", params={"src": src})
        client.get("/api/branches", params={"src": src})

    assert ls_remote.call_count == 2
