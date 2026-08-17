"""Tests for api/scan/blobmeta.py — the facts both git-sourced build paths read
out of blobs, and the leaf they build from them."""

import subprocess
from pathlib import Path

from api.scan.blobmeta import MISSING_BLOB, blob_file_node, resolve_blob_stats
from api.scan.signatures import new_signature


def _init(root: Path) -> None:
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "t"], check=True)


def _commit(root: Path, msg: str) -> None:
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", msg], check=True)


def _blob(root: Path, path: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", f"HEAD:{path}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def test_resolves_only_what_was_asked_for(tmp_path: Path) -> None:
    """The timeline ships this table over the wire, so returning the whole warm
    cache would put every blob the repo ever had into the bundle."""
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("1\n2\n")
    (tmp_path / "b.txt").write_text("only mine\n")
    _commit(tmp_path, "c1")
    a, b = _blob(tmp_path, "a.txt"), _blob(tmp_path, "b.txt")

    # Warm the cache with both, then ask for one.
    resolve_blob_stats(tmp_path, [(a, "a.txt"), (b, "b.txt")])
    just_a = resolve_blob_stats(tmp_path, [(a, "a.txt")])

    assert set(just_a) == {a}
    assert just_a[a]["lines"] == 2


def test_line_counts_come_back_for_a_cold_cache(tmp_path: Path) -> None:
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("1\n2\n3\n")
    _commit(tmp_path, "c1")
    a = _blob(tmp_path, "a.txt")

    stats = resolve_blob_stats(tmp_path, [(a, "a.txt")], use_cache=False)
    assert stats[a]["lines"] == 3
    assert stats[a]["binary"] is False


def test_node_carries_the_whole_optional_trio() -> None:
    """Regression: the union path used to read these fields by hand and once
    shipped a binary as a plain building. Both git paths go through one reader
    now, so a node gets binary, binaryType and the media pair or none of them."""
    node = blob_file_node(
        new_signature(),
        name="shot.png",
        rel_path="img/shot.png",
        root_abs="/repo",
        size=4096,
        lines=0,
        stats={
            "lines": 0,
            "binary": True,
            "media_width": 800,
            "media_height": 600,
            "binaryType": "PNG image",
        },
        created="2020-01-01T00:00:00Z",
        modified="2020-06-01T00:00:00Z",
    )

    assert node.binary is True
    assert node.binaryType == "PNG image"
    assert (node.media_width, node.media_height) == (800, 600)
    assert node.fullPath == "/repo/img/shot.png"
    assert node.extension == ".png"
    # A commit has neither, whichever git path built this.
    assert node.dirty is False


def test_node_survives_a_blob_with_no_stats() -> None:
    """A sha missing from the table still has to render, or the tree loses a
    file that genuinely exists at that commit."""
    node = blob_file_node(
        new_signature(),
        name="a.txt",
        rel_path="a.txt",
        root_abs="/repo",
        size=12,
        lines=0,
        stats=MISSING_BLOB,
        created="",
        modified="",
    )

    assert node.binary is False
    assert node.lines == 0
    assert node.media_width is None and node.media_height is None


def test_size_and_lines_are_the_callers_to_choose() -> None:
    """The ref path passes one blob's numbers and the union path passes the max
    over history; the stats they read the rest from are the same shape."""
    stats = {"lines": 9, "binary": False}
    node = blob_file_node(
        new_signature(),
        name="a.txt",
        rel_path="a.txt",
        root_abs="/repo",
        size=500,
        lines=42,
        stats=stats,
        created="",
        modified="",
    )

    assert (node.size, node.lines) == (500, 42)
