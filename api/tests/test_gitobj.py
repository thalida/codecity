"""Tests for api/services/gitobj.py — read-only git-object plumbing used
to reconstruct a manifest at a past ref (resolve_ref, ls_tree_files,
blob_stats_batch)."""

import subprocess
from pathlib import Path

from api.services.gitobj import (
    resolve_ref,
    ls_tree_files,
    blob_stats_batch,
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


def test_blob_stats_batch_empty_and_missing_sha(tmp_path: Path) -> None:
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\n")
    sha = _commit(tmp_path, "c1")
    [blob] = ls_tree_files(tmp_path, sha)

    assert blob_stats_batch(tmp_path, []) == {}

    # A sha git doesn't have (never committed) comes back "missing" from
    # cat-file --batch and must be skipped rather than raise or corrupt
    # the parse of the sibling entries around it.
    bogus = "f" * 40
    stats = blob_stats_batch(tmp_path, [bogus, blob.sha])
    assert bogus not in stats
    assert stats[blob.sha].lines == 1
