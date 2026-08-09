"""TestClient coverage for /api/discover.

The endpoint's contract is that it always answers 200 with a list: Discover is
one tab on the landing page, so every way the curated file can be wrong has to
degrade to empty rather than propagate.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


@pytest.fixture()
def curated(tmp_path: Path, monkeypatch):
    """Point CODECITY_DISCOVER_FILE at a file this test controls."""

    def _write(content: str) -> Path:
        path = tmp_path / "discover.json"
        path.write_text(content)
        monkeypatch.setenv("CODECITY_DISCOVER_FILE", str(path))
        return path

    return _write


def test_serves_the_curated_list(client: TestClient, curated, monkeypatch) -> None:
    monkeypatch.delenv("CODECITY_DISCOVER", raising=False)
    curated(json.dumps([{"url": "https://example.com/a/b", "label": "b"}]))
    assert client.get("/api/discover").json() == {
        "repos": [{"url": "https://example.com/a/b", "label": "b"}]
    }


def test_bundled_list_is_served_by_default(client: TestClient, monkeypatch) -> None:
    """No env set at all: the file shipped in api/ is what a fresh install
    gets, so it has to parse and be non-empty."""
    monkeypatch.delenv("CODECITY_DISCOVER", raising=False)
    monkeypatch.delenv("CODECITY_DISCOVER_FILE", raising=False)
    repos = client.get("/api/discover").json()["repos"]
    assert repos
    assert all(r["url"].startswith("https://") and r["label"] for r in repos)


def test_bundled_list_exercises_the_generic_hosting_icon(
    client: TestClient, monkeypatch
) -> None:
    """The row icon falls back to a globe off GitHub/GitLab/Bitbucket. Keeping
    a non-GitHub entry in the shipped list means that branch is reachable
    without anyone having to construct it."""
    monkeypatch.delenv("CODECITY_DISCOVER", raising=False)
    monkeypatch.delenv("CODECITY_DISCOVER_FILE", raising=False)
    repos = client.get("/api/discover").json()["repos"]
    assert any("github.com" not in r["url"] for r in repos)


@pytest.mark.parametrize("value", ["off", "0", "false", "no"])
def test_disabled_returns_empty(
    client: TestClient, curated, monkeypatch, value
) -> None:
    curated(json.dumps([{"url": "https://example.com/a/b", "label": "b"}]))
    monkeypatch.setenv("CODECITY_DISCOVER", value)
    assert client.get("/api/discover").json() == {"repos": []}


def test_missing_file_returns_empty(
    client: TestClient, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.delenv("CODECITY_DISCOVER", raising=False)
    monkeypatch.setenv("CODECITY_DISCOVER_FILE", str(tmp_path / "nope.json"))
    r = client.get("/api/discover")
    assert r.status_code == 200
    assert r.json() == {"repos": []}


@pytest.mark.parametrize(
    "content",
    [
        "{not json",
        '{"repos": []}',  # the response shape, not the file shape
        '[{"url": "https://example.com/a"}]',  # label missing
        '["https://example.com/a"]',  # bare strings
        "null",
    ],
)
def test_malformed_file_returns_empty(
    client: TestClient, curated, monkeypatch, content
) -> None:
    monkeypatch.delenv("CODECITY_DISCOVER", raising=False)
    curated(content)
    r = client.get("/api/discover")
    assert r.status_code == 200
    assert r.json() == {"repos": []}
