"""TestClient coverage for health/config + static SPA serving + docs."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html><body>hi</body></html>")
    (static / "assets").mkdir()
    (static / "assets" / "main.js").write_text("console.log('ok')")
    app = create_app(static_dir=static)
    return TestClient(app)


def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_config_default_disabled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The conftest sets CODECITY_ALLOW_LOCAL_REPOS=1 session-wide for
    # tests that exercise local scan paths. Override it here to verify the
    # default-disabled state that the real endpoint exposes.
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html/>")
    app = create_app(static_dir=static)
    r = TestClient(app).get("/api/config")
    assert r.status_code == 200
    assert r.json() == {"allowLocalRepos": False}


def test_root_serves_index(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert "<body>hi</body>" in r.text


def test_static_asset(client: TestClient) -> None:
    r = client.get("/assets/main.js")
    assert r.status_code == 200
    assert r.text == "console.log('ok')"


def test_unknown_api_route_404_json(client: TestClient) -> None:
    r = client.get("/api/nope")
    assert r.status_code == 404
    assert "error" in r.json()


def test_spa_fallback_serves_index_for_unknown_non_api(client: TestClient) -> None:
    r = client.get("/some/spa/route")
    assert r.status_code == 200
    assert "<body>hi</body>" in r.text


def test_openapi_relocated(client: TestClient) -> None:
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/openapi.json").status_code == 404  # default disabled


def test_scalar_docs_served(client: TestClient) -> None:
    r = client.get("/api/docs")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
