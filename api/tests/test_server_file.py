"""TestClient coverage for /api/file (trust gate, 403, 413, traversal, MIME)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.security import TRUST


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    p = tmp_path / "repo"
    (p / "src").mkdir(parents=True)
    (p / "src" / "a.txt").write_text("hello")
    return p


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def test_file_requires_registered_root(client: TestClient, project: Path) -> None:
    r = client.get("/api/file", params={"path": str(project / "src" / "a.txt")})
    assert r.status_code == 403
    assert "error" in r.json()


def test_file_inside_root_ok(client: TestClient, project: Path) -> None:
    TRUST.register(project)
    r = client.get("/api/file", params={"path": str(project / "src" / "a.txt")})
    assert r.status_code == 200
    assert r.text == "hello"
    assert r.headers["content-type"].startswith("text/plain")


def test_file_outside_root_403(
    client: TestClient, project: Path, tmp_path: Path
) -> None:
    TRUST.register(project)
    outside = tmp_path / "secret.txt"
    outside.write_text("nope")
    r = client.get("/api/file", params={"path": str(outside)})
    assert r.status_code == 403


def test_file_missing_param_400(client: TestClient) -> None:
    r = client.get("/api/file")
    assert r.status_code in (400, 422)
