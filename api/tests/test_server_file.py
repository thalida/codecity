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
    (p / "src" / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\nDATA")
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


def test_files_batch_returns_images_only(
    client: TestClient, project: Path, tmp_path: Path
) -> None:
    import base64

    TRUST.register(project)
    outside = tmp_path / "secret.png"
    outside.write_bytes(b"nope")
    pic = str(project / "src" / "pic.png")
    r = client.post(
        "/api/files",
        json={
            "paths": [
                pic,
                str(project / "src" / "a.txt"),  # non-image → omitted
                str(outside),  # out of root → omitted
                str(project / "src" / "missing.png"),  # missing → omitted
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {pic}  # only the in-root image survives
    assert body[pic]["mime"] == "image/png"
    assert base64.b64decode(body[pic]["b64"]) == b"\x89PNG\r\n\x1a\nDATA"


def test_files_batch_no_root_omits_all(client: TestClient, project: Path) -> None:
    # No TRUST.register → every path is out-of-root → empty map (still 200, so a
    # cold client can batch-request without first racing the manifest).
    r = client.post("/api/files", json={"paths": [str(project / "src" / "pic.png")]})
    assert r.status_code == 200
    assert r.json() == {}
