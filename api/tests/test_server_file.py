"""TestClient coverage for /api/file (trust gate, 403, 413, 202, traversal, MIME)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.core.security import TRUST


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
        "/api/images",
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
    r = client.post("/api/images", json={"paths": [str(project / "src" / "pic.png")]})
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


# ── 202: the content isn't here YET ─────────────────────────────────────────

# A repo mid-fetch turns one page of previews into a burst, and a burst of 404s
# is what gets a client blocked. Nor may these download on the request thread.


def _lfs_pointer(oid: str, size: int) -> bytes:
    return (
        b"version https://git-lfs.github.com/spec/v1\n"
        b"oid sha256:" + oid.encode() + b"\nsize " + str(size).encode() + b"\n"
    )


def _write_lfs_object(root: Path, oid: str, real: bytes) -> None:
    obj = root / ".git" / "lfs" / "objects" / oid[:2] / oid[2:4] / oid
    obj.parent.mkdir(parents=True, exist_ok=True)
    obj.write_bytes(real)


def test_unpulled_lfs_file_is_202_not_the_pointer_text(
    client: TestClient, project: Path
) -> None:
    """A failed `lfs pull` leaves a pointer stub on disk. Serving it 200 hands
    the preview 130 bytes of metadata to render as the file."""
    from unittest import mock

    from api.git import objects as objects_mod

    TRUST.reset()
    TRUST.register(project)
    (project / "src" / "art.png").write_bytes(_lfs_pointer("a" * 64, 4096))

    with mock.patch.object(objects_mod, "_lfs_smudge") as smudge:
        r = client.get("/api/file", params={"path": str(project / "src" / "art.png")})
    smudge.assert_not_called()
    assert r.status_code == 202
    assert r.json()["status"] == "pending"
    assert "Git LFS" in r.json()["message"]
    # The URL is keyed on mtime, which the fetch landing doesn't change.
    assert r.headers["cache-control"] == "no-store"


def test_lfs_file_is_served_when_its_object_is_already_local(
    client: TestClient, project: Path
) -> None:
    """`lfs fetch` downloads objects without touching the checkout, so a pointer
    on disk doesn't mean the bytes are absent. Look before answering pending."""
    TRUST.reset()
    TRUST.register(project)
    oid = "c" * 64
    (project / "src" / "art.png").write_bytes(_lfs_pointer(oid, 8))
    _write_lfs_object(project, oid, b"\x89PNG\r\n\x1a\nREAL")

    r = client.get("/api/file", params={"path": str(project / "src" / "art.png")})
    assert r.status_code == 200
    assert r.content == b"\x89PNG\r\n\x1a\nREAL"


def test_unfetched_blob_in_a_partial_clone_is_202(
    client: TestClient, tmp_path: Path
) -> None:
    """A blobless clone hasn't downloaded every historical blob, and can't tell
    "not fetched" from "not here" without the round trip we refuse to make."""
    repo = tmp_path / "partial"
    _sha, gone_path = _git_repo_with_history(repo)
    subprocess.run(
        ["git", "-C", str(repo), "config", "extensions.partialclone", "origin"],
        check=True,
    )
    from api.git.objects import _is_partial_clone

    _is_partial_clone.cache_clear()
    TRUST.reset()
    TRUST.register(repo)

    r = client.get("/api/file", params={"path": gone_path, "sha": "0" * 40})
    assert r.status_code == 202
    assert r.json()["status"] == "pending"
    _is_partial_clone.cache_clear()


def test_unpulled_lfs_blob_is_202(client: TestClient, tmp_path: Path) -> None:
    """Timeline reading a version whose lfs object was never pulled: 202, and no
    smudge, which would be a download with a browser waiting on it."""
    from unittest import mock

    from api.git import objects as objects_mod

    repo = tmp_path / "lfshist"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "t"], check=True)
    (repo / "clip.mp4").write_bytes(_lfs_pointer("d" * 64, 900))
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", "add"], check=True)
    sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD:clip.mp4"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    TRUST.reset()
    TRUST.register(repo)

    with mock.patch.object(objects_mod, "_lfs_smudge") as smudge:
        r = client.get("/api/file", params={"path": str(repo / "clip.mp4"), "sha": sha})
    smudge.assert_not_called()
    assert r.status_code == 202
    assert r.json()["status"] == "pending"


def test_images_batch_names_an_unpulled_lfs_image_pending(
    client: TestClient, project: Path
) -> None:
    """Pointer text is not an image, but omitting it sends the client to the
    single-file GET: one wasted request per building, ending in a 202."""
    TRUST.reset()
    TRUST.register(project)
    stub = project / "src" / "stub.png"
    stub.write_bytes(_lfs_pointer("e" * 64, 4096))

    r = client.post("/api/images", json={"paths": [str(stub)]})
    assert r.status_code == 200
    assert r.json() == {str(stub): {"status": "pending"}}


def test_fingerprints_batch_refuses_to_fingerprint_a_pointer_stub(
    client: TestClient, project: Path
) -> None:
    """The stub's head is ASCII metadata: fingerprinting it draws a byte pattern
    of the pointer and hangs it on the building as the file's own."""
    TRUST.reset()
    TRUST.register(project)
    stub = project / "src" / "big.bin"
    stub.write_bytes(_lfs_pointer("f" * 64, 90000))

    r = client.post("/api/fingerprints", json={"paths": [str(stub)]})
    assert r.status_code == 200
    assert r.json() == {str(stub): {"status": "pending"}}
