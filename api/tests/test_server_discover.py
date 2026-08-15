"""TestClient coverage for /api/discover.

The endpoint's contract is that it always answers 200 with a list: Discover is
one tab on the landing page, so every way the curated file can be wrong has to
degrade to empty rather than propagate.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

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
        "repos": [{"url": "https://example.com/a/b", "label": "b", "featured": False}]
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


def test_bundled_list_spans_several_hosts(client: TestClient, monkeypatch) -> None:
    """Discover is where "any git URL" stops being a claim: a list that is all
    one host teaches the opposite, whatever the form's label says. Hosts people
    recognise only, since every row here is a recommendation."""
    monkeypatch.delenv("CODECITY_DISCOVER", raising=False)
    monkeypatch.delenv("CODECITY_DISCOVER_FILE", raising=False)
    repos = client.get("/api/discover").json()["repos"]
    hosts = {urlparse(r["url"]).netloc for r in repos}
    assert len(hosts) >= 4, hosts


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


class TestFeatured:
    """The featured repo is the one the landing renders behind itself, so it
    also appears in Discover, flagged and first: someone wondering what they're
    looking at should find it as the first row, not hunt for a badge."""

    FEATURED = "https://github.com/thalida/codecity"

    def test_leads_the_list_and_is_flagged(
        self, client: TestClient, curated, monkeypatch
    ) -> None:
        curated(json.dumps([{"url": "https://example.com/a/b", "label": "b"}]))
        monkeypatch.setenv("CODECITY_FEATURED_REPO", self.FEATURED)
        repos = client.get("/api/discover").json()["repos"]
        assert repos[0] == {
            "url": self.FEATURED,
            "label": "thalida/codecity",
            "featured": True,
        }
        assert [r["featured"] for r in repos[1:]] == [False]

    def test_a_curated_entry_is_marked_rather_than_duplicated(
        self, client: TestClient, curated, monkeypatch
    ) -> None:
        """Hand-curating the featured repo into the file must not produce two
        near-identical rows."""
        curated(json.dumps([{"url": self.FEATURED, "label": "codecity"}]))
        monkeypatch.setenv("CODECITY_FEATURED_REPO", self.FEATURED)
        repos = client.get("/api/discover").json()["repos"]
        assert len(repos) == 1
        assert repos[0] == {"url": self.FEATURED, "label": "codecity", "featured": True}

    def test_appears_even_when_the_curated_file_is_missing(
        self, client: TestClient, tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setenv("CODECITY_DISCOVER_FILE", str(tmp_path / "nope.json"))
        monkeypatch.setenv("CODECITY_FEATURED_REPO", self.FEATURED)
        repos = client.get("/api/discover").json()["repos"]
        assert [r["url"] for r in repos] == [self.FEATURED]

    def test_switching_discover_off_hides_it_too(
        self, client: TestClient, monkeypatch
    ) -> None:
        """The tab is gone, featured row included. The landing's backdrop is a
        separate question, answered by /api/config."""
        monkeypatch.setenv("CODECITY_FEATURED_REPO", self.FEATURED)
        monkeypatch.setenv("CODECITY_DISCOVER", "off")
        assert client.get("/api/discover").json() == {"repos": []}

    def test_off_by_default_leaves_the_list_alone(
        self, client: TestClient, curated, monkeypatch
    ) -> None:
        """A fresh install renders no backdrop, so nothing is injected."""
        curated(json.dumps([{"url": "https://example.com/a/b", "label": "b"}]))
        monkeypatch.delenv("CODECITY_FEATURED_REPO", raising=False)
        repos = client.get("/api/discover").json()["repos"]
        assert [r["featured"] for r in repos] == [False]
