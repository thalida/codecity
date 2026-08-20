"""Tests for api/git/objects.py — read-only git-object plumbing used
to reconstruct a manifest at a past ref (resolve_ref, ls_tree_files,
blob_stats_batch)."""

import os
import subprocess
from pathlib import Path

from api.git.objects import (
    resolve_ref,
    ls_tree_files,
    blob_stats_batch,
    blob_sizes_batch,
)


def _init(root: Path) -> None:
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "t"], check=True)


def _commit(root: Path, msg: str) -> str:
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", msg], check=True)
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def test_resolve_ref_valid_and_invalid(tmp_path: Path) -> None:
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\ntwo\n")
    sha = _commit(tmp_path, "c1")
    assert resolve_ref(tmp_path, "HEAD") == sha
    assert resolve_ref(tmp_path, sha[:8]) == sha  # short sha resolves to full
    assert resolve_ref(tmp_path, "does-not-exist") is None
    # An injection-style ref must not resolve (and must never reach a git flag).
    assert resolve_ref(tmp_path, "--upload-pack=touched") is None


def test_ls_tree_and_blob_stats(tmp_path: Path) -> None:
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\ntwo\nthree\n")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.py").write_text("x = 1\n")
    (tmp_path / "bin.dat").write_bytes(b"\x00\x01\x02\x00")
    sha = _commit(tmp_path, "c1")

    files = ls_tree_files(tmp_path, sha)
    by_path = {f.path: f for f in files}
    assert set(by_path) == {"a.txt", "sub/b.py", "bin.dat"}
    assert by_path["a.txt"].size == len("one\ntwo\nthree\n")

    stats = blob_stats_batch(tmp_path, [f.sha for f in files])
    assert stats[by_path["a.txt"].sha].lines == 3
    assert stats[by_path["a.txt"].sha].binary is False
    assert stats[by_path["bin.dat"].sha].binary is True
    assert stats[by_path["bin.dat"].sha].lines == 0


def test_ls_tree_files_skips_symlinks(tmp_path: Path) -> None:
    # A committed symlink is git type "blob" too, and the live scan drops
    # symlinks — so skipping them here is what keeps the two trees equal.
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\ntwo\n")
    os.symlink("a.txt", tmp_path / "link.txt")
    sha = _commit(tmp_path, "c1")

    files = ls_tree_files(tmp_path, sha)
    by_path = {f.path: f for f in files}
    assert set(by_path) == {"a.txt"}
    assert "link.txt" not in by_path


def test_blob_stats_batch_empty_and_missing_sha(tmp_path: Path) -> None:
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\n")
    sha = _commit(tmp_path, "c1")
    [blob] = ls_tree_files(tmp_path, sha)

    assert blob_stats_batch(tmp_path, []) == {}

    # An unknown sha comes back "missing" and must be skipped without
    # corrupting the parse of the entries around it.
    bogus = "f" * 40
    stats = blob_stats_batch(tmp_path, [bogus, blob.sha])
    assert bogus not in stats
    assert stats[blob.sha].lines == 1


def test_blob_stats_batch_media_probe_gated_by_extension(tmp_path: Path) -> None:
    """The media-dimension probe must only run for blobs the caller marks
    as media (by extension, mirroring the live scanner) — never for plain
    source files, which would otherwise pay hachoir's full format battery
    (and its stderr `[warn] Skip parser ...` spam) for nothing."""
    _init(tmp_path)
    # Inline rather than a committed fixture: fixtures/sample-repo is
    # gitignored, so a file there is absent on a fresh CI checkout.
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (2, 3)).save(buf, format="PNG")
    (tmp_path / "logo.png").write_bytes(buf.getvalue())
    (tmp_path / "a.txt").write_text("one\ntwo\n")
    sha = _commit(tmp_path, "c1")

    files = ls_tree_files(tmp_path, sha)
    by_path = {f.path: f for f in files}
    png_sha = by_path["logo.png"].sha
    txt_sha = by_path["a.txt"].sha

    # Without media_shas (default), nothing is probed — even the image.
    stats = blob_stats_batch(tmp_path, [f.sha for f in files])
    assert stats[png_sha].media_width is None
    assert stats[png_sha].media_height is None
    assert stats[txt_sha].media_width is None

    # With media_shas naming only the image blob, it alone gets dims.
    stats = blob_stats_batch(
        tmp_path, [f.sha for f in files], media_shas=frozenset({png_sha})
    )
    assert stats[png_sha].media_width is not None
    assert stats[png_sha].media_height is not None
    assert stats[txt_sha].media_width is None
    assert stats[txt_sha].media_height is None


def test_blob_sizes_batch(tmp_path):
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("hello\nworld\n")  # 12 bytes
    _commit(tmp_path, "c1")
    blobs = ls_tree_files(tmp_path, resolve_ref(tmp_path, "HEAD"))
    a = next(b for b in blobs if b.path == "a.txt")
    sizes = blob_sizes_batch(tmp_path, [a.sha])
    assert sizes[a.sha] == 12
    assert blob_sizes_batch(tmp_path, []) == {}


def test_missing_blob_is_skipped_not_fetched(tmp_path):
    # A blob absent from the store must report missing, not trigger a
    # per-object fetch that hangs. Present blobs resolve alongside it.
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\ntwo\n")
    _commit(tmp_path, "c1")
    present = ls_tree_files(tmp_path, resolve_ref(tmp_path, "HEAD"))[0].sha
    absent = "0" * 40
    stats = blob_stats_batch(tmp_path, [present, absent])
    assert present in stats and absent not in stats
    sizes = blob_sizes_batch(tmp_path, [present, absent])
    assert present in sizes and absent not in sizes


def _write_lfs_object(root: Path, oid: str, real: bytes) -> None:
    obj = root / ".git" / "lfs" / "objects" / oid[:2] / oid[2:4] / oid
    obj.parent.mkdir(parents=True, exist_ok=True)
    obj.write_bytes(real)


def _lfs_pointer(oid: str, size: int) -> bytes:
    return (
        b"version https://git-lfs.github.com/spec/v1\n"
        b"oid sha256:" + oid.encode() + b"\nsize " + str(size).encode() + b"\n"
    )


def test_resolve_lfs_pointer(tmp_path):
    """A git-lfs pointer resolves to its LOCAL object's bytes + declared size, so
    timeline blob stats match Live's smudged working tree. Missing object (a
    blobless clone's unfetched history) → (b'', declared size), not the pointer."""
    from api.git.objects import _parse_lfs_pointer, _resolve_lfs

    oid = "a" * 64
    real = b"line1\nline2\nline3\n"
    _write_lfs_object(tmp_path, oid, real)
    pointer = _lfs_pointer(oid, 18)
    assert _parse_lfs_pointer(pointer) == (oid, 18)
    assert _resolve_lfs(tmp_path, pointer, 132, download=False) == (real, 18)
    assert _resolve_lfs(tmp_path, b"plain\n", 6, download=False) == (b"plain\n", 6)
    missing = pointer.replace(oid.encode(), b"f" * 64)
    assert _resolve_lfs(tmp_path, missing, 132, download=False) == (
        b"",
        18,
    )  # unfetched → declared size


def test_resolve_lfs_downloads_only_when_asked(tmp_path):
    """The download switch is the whole protection: a request-path read must not
    reach the lfs endpoint, while the scan's bulk pass still may."""
    from unittest import mock

    from api.git import objects as objects_mod

    missing = _lfs_pointer("f" * 64, 18)
    with mock.patch.object(objects_mod, "_lfs_smudge") as smudge:
        assert objects_mod._resolve_lfs(tmp_path, missing, 132, download=False) == (
            b"",
            18,
        )
        smudge.assert_not_called()

    with mock.patch.object(
        objects_mod, "_lfs_smudge", return_value=b"downloaded\n"
    ) as smudge:
        assert objects_mod._resolve_lfs(tmp_path, missing, 132, download=True) == (
            b"downloaded\n",
            18,
        )
        smudge.assert_called_once()


def test_read_blob_never_downloads_an_lfs_object(tmp_path):
    """read_blob backs a browser request, so an unpulled pointer is PENDING, not
    a download and not a 0-byte body that reads as an empty file."""
    from unittest import mock

    from api.git import objects as objects_mod
    from api.git.objects import BlobUnavailable, read_blob

    _init(tmp_path)
    oid = "b" * 64
    (tmp_path / "big.bin").write_bytes(_lfs_pointer(oid, 12))
    _commit(tmp_path, "c1")
    sha = ls_tree_files(tmp_path, resolve_ref(tmp_path, "HEAD"))[0].sha

    with mock.patch.object(objects_mod, "_lfs_smudge") as smudge:
        assert read_blob(tmp_path, sha) is BlobUnavailable.PENDING
        smudge.assert_not_called()

    # Same blob, once the object is on disk: served without touching the remote.
    _write_lfs_object(tmp_path, oid, b"real bytes\n\n")
    with mock.patch.object(objects_mod, "_lfs_smudge") as smudge:
        assert read_blob(tmp_path, sha) == b"real bytes\n\n"
        smudge.assert_not_called()


def test_read_blob_separates_undownloaded_from_unknown(tmp_path):
    """A full clone knows an absent object doesn't exist. A partial clone can't
    tell that apart from one it never fetched, so it says PENDING and the caller
    can retry rather than being told a permanent no."""
    from api.git.objects import BlobUnavailable, _is_partial_clone, read_blob

    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\n")
    _commit(tmp_path, "c1")
    absent = "0" * 40

    assert read_blob(tmp_path, absent) is BlobUnavailable.MISSING

    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "extensions.partialclone", "origin"],
        check=True,
    )
    _is_partial_clone.cache_clear()
    assert read_blob(tmp_path, absent) is BlobUnavailable.PENDING
