"""TestClient coverage for /api/config across CODECITY_ALLOW_LOCAL_REPOS and
CODECITY_HOSTED states."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.core.config import Settings

FEATURED = Settings.model_fields["featured_repo"].default


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def test_config_enabled(client: TestClient, monkeypatch) -> None:
    from api import __version__

    monkeypatch.setenv("CODECITY_ALLOW_LOCAL_REPOS", "1")
    monkeypatch.delenv("CODECITY_HOSTED", raising=False)
    assert client.get("/api/config").json() == {
        "allowLocalRepos": True,
        "hosted": False,
        "version": __version__,
        "featuredRepo": FEATURED,
    }


def test_config_disabled(client: TestClient, monkeypatch) -> None:
    from api import __version__

    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    monkeypatch.delenv("CODECITY_HOSTED", raising=False)
    assert client.get("/api/config").json() == {
        "allowLocalRepos": False,
        "hosted": False,
        "version": __version__,
        "featuredRepo": FEATURED,
    }


def test_config_hosted(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("CODECITY_HOSTED", "1")
    assert client.get("/api/config").json()["hosted"] is True


def test_config_hosted_fails_closed(client: TestClient, monkeypatch) -> None:
    """A local-flavoured message on a hosted instance is a smaller error than
    telling a local user to go run codecity locally, so `hosted` defaults off."""
    monkeypatch.delenv("CODECITY_HOSTED", raising=False)
    assert client.get("/api/config").json()["hosted"] is False


def test_config_reports_the_running_package_version(client: TestClient) -> None:
    """The footer shows which build is running, so /api/config carries the
    package version rather than the client guessing from a bundled constant."""
    from api import __version__

    body = client.get("/api/config").json()
    assert body["version"] == __version__
    assert body["version"]


def test_config_carries_the_featured_repo(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("CODECITY_FEATURED_REPO", "https://github.com/o/r")
    assert client.get("/api/config").json()["featuredRepo"] == "https://github.com/o/r"


def test_config_featured_repo_can_be_switched_off(
    client: TestClient, monkeypatch
) -> None:
    """Empty means the landing renders no backdrop at all."""
    monkeypatch.setenv("CODECITY_FEATURED_REPO", "")
    assert client.get("/api/config").json()["featuredRepo"] == ""
