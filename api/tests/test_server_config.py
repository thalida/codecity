"""TestClient coverage for /api/config across CODECITY_ALLOW_LOCAL_REPOS states."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.config import MAX_BATCH_PATHS


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def test_config_enabled(client: TestClient, monkeypatch) -> None:
    from api import __version__

    monkeypatch.setenv("CODECITY_ALLOW_LOCAL_REPOS", "1")
    assert client.get("/api/config").json() == {
        "allowLocalRepos": True,
        "maxBatchPaths": MAX_BATCH_PATHS,
        "version": __version__,
    }


def test_config_disabled(client: TestClient, monkeypatch) -> None:
    from api import __version__

    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    assert client.get("/api/config").json() == {
        "allowLocalRepos": False,
        "maxBatchPaths": MAX_BATCH_PATHS,
        "version": __version__,
    }


def test_config_publishes_the_cap_the_batch_routes_enforce() -> None:
    """The batch routes truncate at MAX_BATCH_PATHS; /api/config is how the
    client learns that number instead of hardcoding its own."""
    from api.routers import file as file_router

    assert file_router.MAX_BATCH_PATHS == MAX_BATCH_PATHS


def test_config_reports_the_running_package_version(client: TestClient) -> None:
    """The footer shows which build is running, so /api/config carries the
    package version rather than the client guessing from a bundled constant."""
    from api import __version__

    body = client.get("/api/config").json()
    assert body["version"] == __version__
    assert body["version"]
