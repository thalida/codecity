"""TestClient coverage for /api/file (trust gate, 403, 413, traversal, MIME)."""

from __future__ import annotations

import subprocess
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


def test_fingerprints_batch_returns_png_for_in_root_files(
    client: TestClient, project: Path, tmp_path: Path
) -> None:
    import base64
    import io

    from PIL import Image

    TRUST.register(project)
    db = project / "src" / "data.db"
    db.write_bytes(b"SQLite format 3\x00" + bytes(range(256)) * 40)
    outside = tmp_path / "secret.db"
    outside.write_bytes(b"nope")
    db_path = str(db)
    r = client.post(
        "/api/fingerprints",
        json={
            "paths": [
                db_path,
                str(outside),  # out of root → omitted
                str(project / "src" / "missing.db"),  # missing → omitted
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {db_path}  # only the in-root file survives
    # The b64 decodes to a valid fingerprint PNG (raw bytes never shipped).
    img = Image.open(io.BytesIO(base64.b64decode(body[db_path]["b64"])))
    assert img.format == "PNG"
    assert img.size == (128, 128)


def test_fingerprints_no_root_omits_all(client: TestClient, project: Path) -> None:
    r = client.post(
        "/api/fingerprints", json={"paths": [str(project / "src" / "pic.png")]}
    )
    assert r.status_code == 200
    assert r.json() == {}


def test_files_batch_no_root_omits_all(client: TestClient, project: Path) -> None:
    # No TRUST.register → every path is out-of-root → empty map (still 200, so a
    # cold client can batch-request without first racing the manifest).
    r = client.post("/api/files", json={"paths": [str(project / "src" / "pic.png")]})
    assert r.status_code == 200
    assert r.json() == {}


# ── GET /api/file?sha= (Timeline: file bytes at a past commit) ──────────────


def _git_repo_with_history(root: Path) -> tuple[str, str]:
    """Repo where doomed.txt is created then deleted. Returns (blob sha, path)."""
    root.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "t"], check=True)
    doomed = root / "doomed.txt"
    doomed.write_text("historical content\n")
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "add"], check=True)
    sha = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD:doomed.txt"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    doomed.unlink()
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "rm"], check=True)
    return sha, str(doomed)


def test_blob_serves_a_file_that_no_longer_exists(
    client: TestClient, tmp_path: Path
) -> None:
    """The whole point: a path deleted since HEAD still resolves by sha. This is
    what stopped the Timeline media 404s."""
    repo = tmp_path / "hist"
    sha, gone_path = _git_repo_with_history(repo)
    TRUST.reset()
    TRUST.register(repo)

    assert not Path(gone_path).exists()
    r = client.get("/api/file", params={"path": gone_path, "sha": sha})
    assert r.status_code == 200
    assert r.text == "historical content\n"
    # Without a sha the same URL reads the working tree, where it is gone.
    assert client.get("/api/file", params={"path": gone_path}).status_code == 404


def test_blob_rejects_a_malformed_sha(client: TestClient, tmp_path: Path) -> None:
    repo = tmp_path / "hist2"
    _sha, gone_path = _git_repo_with_history(repo)
    TRUST.reset()
    TRUST.register(repo)

    for bad in ["", "abc", "z" * 40, "../../etc/passwd"]:
        r = client.get("/api/file", params={"path": gone_path, "sha": bad})
        assert r.status_code in (400, 422), bad


def test_blob_refuses_paths_outside_the_root(
    client: TestClient, tmp_path: Path
) -> None:
    """must_exist=False must not become a traversal hole: `..` is still
    normalized before the containment check."""
    repo = tmp_path / "hist3"
    sha, _gone = _git_repo_with_history(repo)
    TRUST.reset()
    TRUST.register(repo)

    escaped = str(repo / ".." / "elsewhere" / "secret.txt")
    r = client.get("/api/file", params={"path": escaped, "sha": sha})
    assert r.status_code == 403


def test_blob_404s_for_a_sha_not_in_the_repo(
    client: TestClient, tmp_path: Path
) -> None:
    repo = tmp_path / "hist4"
    _sha, gone_path = _git_repo_with_history(repo)
    TRUST.reset()
    TRUST.register(repo)

    r = client.get("/api/file", params={"path": gone_path, "sha": "0" * 40})
    assert r.status_code == 404
