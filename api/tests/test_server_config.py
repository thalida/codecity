"""TestClient coverage for /api/config across CODECITY_ALLOW_LOCAL_REPOS states."""

from __future__ import annotations

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


def test_config_enabled(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("CODECITY_ALLOW_LOCAL_REPOS", "1")
    assert client.get("/api/config").json() == {"allowLocalRepos": True}


def test_config_disabled(client: TestClient, monkeypatch) -> None:
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    assert client.get("/api/config").json() == {"allowLocalRepos": False}
