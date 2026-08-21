"""TestClient coverage for /api/file (source resolution, 403, 413, 202, traversal, MIME)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    """A local source as reads see one: a git working tree, since that is the
    only kind of local path a scan would have accepted."""
    p = tmp_path / "repo"
    (p / "src").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(p)], check=True)
    (p / "src" / "a.txt").write_text("hello")
    (p / "src" / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\nDATA")
    return p


def _get(
    client: TestClient, route: str, root: Path, rel: str, **params: str
) -> "object":
    """A read the way the app makes it: the source, and a path inside it."""
    return client.get(route, params={"src": str(root), "path": rel, **params})


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


def test_file_inside_root_ok(client: TestClient, project: Path) -> None:
    r = _get(client, "/api/file", project, "src/a.txt")
    assert r.status_code == 200
    assert r.text == "hello"
    assert r.headers["content-type"].startswith("text/plain")


def test_file_survives_the_process_that_scanned_it(
    client: TestClient, project: Path
) -> None:
    """The bug this route was rebuilt for: a browser holds its manifest for as
    long as the tab is open, and nothing about a read may depend on the server
    still remembering the scan that produced it."""
    fresh = TestClient(create_app())
    r = _get(fresh, "/api/file", project, "src/a.txt")
    assert r.status_code == 200
    assert r.text == "hello"


def test_file_from_a_source_that_is_not_on_disk_404s(
    client: TestClient, tmp_path: Path
) -> None:
    r = _get(client, "/api/file", tmp_path / "never-scanned", "a.txt")
    assert r.status_code == 404
    assert "error" in r.json()


def test_file_refuses_a_local_source_that_is_not_a_repo(
    client: TestClient, tmp_path: Path
) -> None:
    """A read may reach no further than a scan of the same path could, and a
    scan refuses anything outside a git working tree."""
    plain = tmp_path / "not-a-repo"
    plain.mkdir()
    (plain / "secrets.txt").write_text("nope")
    assert _get(client, "/api/file", plain, "secrets.txt").status_code == 404


def test_file_reads_a_subdirectory_of_a_repo(client: TestClient, project: Path) -> None:
    """resolve_local admits a subdirectory of a working tree, so a read of one
    has to work too — the marker is up the tree, not in it."""
    assert _get(client, "/api/file", project / "src", "a.txt").status_code == 200


def test_file_refuses_a_local_source_when_local_repos_are_off(
    client: TestClient, project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The hosted gate: a deploy that serves no local paths must not serve
    their files either."""
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    assert _get(client, "/api/file", project, "src/a.txt").status_code == 403


def test_file_outside_root_403(
    client: TestClient, project: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "secret.txt"
    outside.write_text("nope")
    for escape in ["../secret.txt", str(outside)]:
        assert _get(client, "/api/file", project, escape).status_code == 403


def test_file_missing_param_400(client: TestClient, project: Path) -> None:
    assert client.get("/api/file").status_code in (400, 422)
    assert client.get("/api/file", params={"src": str(project)}).status_code in (
        400,
        422,
    )


def test_image_served_as_its_own_mime(client: TestClient, project: Path) -> None:
    """The city's billboards read the bytes straight off this route: one request
    per image, its own content type, no base64 in the middle."""
    r = _get(client, "/api/file", project, "src/pic.png")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == b"\x89PNG\r\n\x1a\nDATA"


def test_versioned_url_is_cacheable_and_bare_one_is_not(
    client: TestClient, project: Path
) -> None:
    """The whole reason one-request-per-file beats a batch: an mtime or sha in
    the URL names one immutable body, so a rebuild re-reads it from the browser
    instead of the network. Without one, the same URL means "whatever is there
    now" and must never stick."""
    versioned = _get(client, "/api/file", project, "src/pic.png", mtime="2026-01-01")
    assert "immutable" in versioned.headers["cache-control"]

    bare = _get(client, "/api/file", project, "src/pic.png")
    assert "immutable" not in bare.headers["cache-control"]


# ── GET /api/fingerprint (the byte pattern a binary file wears) ──────────────


def test_fingerprint_returns_a_png_for_an_in_root_file(
    client: TestClient, project: Path
) -> None:
    import io

    from PIL import Image

    db = project / "src" / "data.db"
    db.write_bytes(b"SQLite format 3\x00" + bytes(range(256)) * 40)

    r = _get(client, "/api/fingerprint", project, "src/data.db")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    # The PNG ships, the file's own bytes never do.
    img = Image.open(io.BytesIO(r.content))
    assert img.format == "PNG"
    assert img.size == (128, 128)


def test_fingerprint_refuses_paths_outside_the_root(
    client: TestClient, project: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "secret.db"
    outside.write_bytes(b"nope")
    assert _get(client, "/api/fingerprint", project, "../secret.db").status_code == 403
    assert (
        _get(client, "/api/fingerprint", project, "src/missing.db").status_code == 404
    )


# ── GET /api/file?sha= (Timeline: file bytes at a past commit) ──────────────


def _git_repo_with_history(root: Path) -> tuple[str, str]:
    """Repo where doomed.txt is created then deleted. Returns (blob sha, the
    repo-relative path it had)."""
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
    return sha, "doomed.txt"


def test_blob_serves_a_file_that_no_longer_exists(
    client: TestClient, tmp_path: Path
) -> None:
    """The whole point: a path deleted since HEAD still resolves by sha. This is
    what stopped the Timeline media 404s."""
    repo = tmp_path / "hist"
    sha, gone_path = _git_repo_with_history(repo)

    assert not (repo / gone_path).exists()
    r = _get(client, "/api/file", repo, gone_path, sha=sha)
    assert r.status_code == 200
    assert r.text == "historical content\n"
    # Without a sha the same URL reads the working tree, where it is gone.
    assert _get(client, "/api/file", repo, gone_path).status_code == 404


def test_blob_rejects_a_malformed_sha(client: TestClient, tmp_path: Path) -> None:
    repo = tmp_path / "hist2"
    _sha, gone_path = _git_repo_with_history(repo)

    for bad in ["", "abc", "z" * 40, "../../etc/passwd"]:
        r = _get(client, "/api/file", repo, gone_path, sha=bad)
        assert r.status_code in (400, 422), bad


def test_blob_refuses_paths_outside_the_root(
    client: TestClient, tmp_path: Path
) -> None:
    """must_exist=False must not become a traversal hole: `..` is still
    normalized before the containment check."""
    repo = tmp_path / "hist3"
    sha, _gone = _git_repo_with_history(repo)

    r = _get(client, "/api/file", repo, "../elsewhere/secret.txt", sha=sha)
    assert r.status_code == 403


def test_blob_404s_for_a_sha_not_in_the_repo(
    client: TestClient, tmp_path: Path
) -> None:
    repo = tmp_path / "hist4"
    _sha, gone_path = _git_repo_with_history(repo)

    r = _get(client, "/api/file", repo, gone_path, sha="0" * 40)
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

    (project / "src" / "art.png").write_bytes(_lfs_pointer("a" * 64, 4096))

    with mock.patch.object(objects_mod, "_lfs_smudge") as smudge:
        r = _get(client, "/api/file", project, "src/art.png")
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
    oid = "c" * 64
    (project / "src" / "art.png").write_bytes(_lfs_pointer(oid, 8))
    _write_lfs_object(project, oid, b"\x89PNG\r\n\x1a\nREAL")

    r = _get(client, "/api/file", project, "src/art.png")
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

    r = _get(client, "/api/file", repo, gone_path, sha="0" * 40)
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
    with mock.patch.object(objects_mod, "_lfs_smudge") as smudge:
        r = _get(client, "/api/file", repo, "clip.mp4", sha=sha)
    smudge.assert_not_called()
    assert r.status_code == 202
    assert r.json()["status"] == "pending"


def test_fingerprint_refuses_to_fingerprint_a_pointer_stub(
    client: TestClient, project: Path
) -> None:
    """The stub's head is ASCII metadata: fingerprinting it draws a byte pattern
    of the pointer and hangs it on the building as the file's own."""
    stub = project / "src" / "big.bin"
    stub.write_bytes(_lfs_pointer("f" * 64, 90000))

    r = _get(client, "/api/fingerprint", project, "src/big.bin")
    assert r.status_code == 202
    assert r.json()["status"] == "pending"
