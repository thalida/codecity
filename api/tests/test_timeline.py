"""Tests for api/services/timeline.py — the per-commit blob-delta walk
that the client replays to reconstruct any commit's file set."""

import os
import subprocess
from pathlib import Path

from api.services.timeline import walk_deltas


def _init(root: Path) -> None:
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "t"], check=True)


def _commit(root: Path, msg: str) -> None:
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", msg], check=True)


def _blob(root: Path, ref: str, path: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", f"{ref}:{path}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def test_walk_deltas_add_modify_delete(tmp_path: Path) -> None:
    _init(tmp_path)
    (tmp_path / "a.txt").write_text("1\n")
    _commit(tmp_path, "c1")
    (tmp_path / "a.txt").write_text("1\n2\n")
    (tmp_path / "b.txt").write_text("new\n")
    _commit(tmp_path, "c2")
    (tmp_path / "a.txt").unlink()
    _commit(tmp_path, "c3")

    deltas = walk_deltas(tmp_path)
    assert len(deltas) == 3  # oldest-first
    assert deltas[0].changes == [("a.txt", _blob(tmp_path, "HEAD~2", "a.txt"))]
    paths2 = {p for p, _ in deltas[1].changes}
    assert paths2 == {"a.txt", "b.txt"}
    assert deltas[2].changes == [("a.txt", None)]


def test_walk_deltas_file_to_symlink_typechange_is_a_deletion(tmp_path: Path) -> None:
    """A tracked file replaced in-place by a symlink at the same path (:100644
    120000 ... T) must be recorded as a deletion, so replay drops it exactly
    like reconstruct_manifest (via ls_tree_files) excludes symlinks."""
    from api.services.scan import reconstruct_manifest

    _init(tmp_path)
    (tmp_path / "x.txt").write_text("hello\n")
    _commit(tmp_path, "c1")
    (tmp_path / "x.txt").unlink()
    os.symlink("target", tmp_path / "x.txt")
    _commit(tmp_path, "c2")
    head = subprocess.run(
        ["git", "-C", str(tmp_path), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    deltas = walk_deltas(tmp_path)
    assert deltas[1].changes == [("x.txt", None)]

    state: dict[str, str] = {}
    for d in deltas:
        for path, sha in d.changes:
            if sha is None:
                state.pop(path, None)
            else:
                state[path] = sha
    assert "x.txt" not in state

    recon = reconstruct_manifest(str(tmp_path), head, use_cache=False)
    recon_paths: set[str] = set()

    def walk(n: dict) -> None:
        if n["type"] == "file":
            recon_paths.add(n["path"])
        else:
            for ch in n["children"]:
                walk(ch)

    walk(recon["tree"])
    assert "x.txt" not in recon_paths
    assert set(state) == recon_paths


def test_union_manifest_is_all_paths_max_size(tmp_path: Path) -> None:
    from api.services.timeline import (
        walk_deltas,
        build_union_manifest,
        _collect_blob_tables,
    )

    _init(tmp_path)
    (tmp_path / "a.txt").write_text("x\n")
    _commit(tmp_path, "c1")
    (tmp_path / "a.txt").write_text("x\ny\nz\n")  # a.txt grows
    (tmp_path / "gone.txt").write_text("bye\n")
    (tmp_path / "app.db").write_bytes(b"SQLite format 3\x00" + bytes(range(256)) * 4)
    _commit(tmp_path, "c2")
    (tmp_path / "gone.txt").unlink()  # deleted, still in union
    _commit(tmp_path, "c3")

    deltas = walk_deltas(tmp_path)
    lines, sizes, blob_stats = _collect_blob_tables(tmp_path, deltas)
    from api.services.scan import _collect_git_history

    created, modified, commits = _collect_git_history(tmp_path, use_cache=False)
    m = build_union_manifest(
        tmp_path, deltas, lines, sizes, blob_stats, commits, created, modified
    )

    nodes: dict[str, dict] = {}

    def walk(n: dict) -> None:
        if n["type"] == "file":
            nodes[n["path"]] = n
        else:
            for c in n["children"]:
                walk(c)

    walk(m["tree"])
    assert set(nodes) == {"a.txt", "gone.txt", "app.db"}  # deleted file is in the union
    assert nodes["a.txt"]["size"] == len("x\ny\nz\n")  # MAX size over history
    assert m["repo"]["dirty"] is False
    assert "T" in nodes["a.txt"]["created"]  # full ISO timestamp, not day-precision
    assert "T" in nodes["a.txt"]["modified"]
    # Regression: a binary file must carry binary/binaryType in the union manifest
    # too (was hardcoded binary=False), so Timeline renders it as a data building.
    assert nodes["app.db"]["binary"] is True
    assert nodes["app.db"]["binaryType"] == "SQLite database"
    assert nodes["a.txt"]["binary"] is False


def test_bundle_replay_matches_reconstruct(tmp_path: Path) -> None:
    """Replaying deltas[0..i] reproduces reconstruct_manifest's file set + lines
    at that ref — ties the bundle to the proven phase-1 reconstruction. The
    fixture commits paths the live scan drops (ALWAYS_SKIP lockfile, a symlink,
    a .codecityignore entry) to guard that the timeline path applies the
    identical skip filter at every commit."""
    from api.services.timeline import build_timeline_bundle
    from api.services.scan import reconstruct_manifest

    _init(tmp_path)
    (tmp_path / "a.txt").write_text("1\n2\n")
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "b.py").write_text("x=1\n")
    # ALWAYS_SKIP lockfile, a committed symlink, and a .codecityignore exclude — none may reach the bundle.
    (tmp_path / "package-lock.json").write_text('{"a":1}\n' * 50)
    os.symlink("a.txt", tmp_path / "link.txt")
    (tmp_path / "secret").mkdir()
    (tmp_path / "secret" / "hush.txt").write_text("shh\n")
    (tmp_path / ".codecityignore").write_text("secret/hush.txt\n")
    _commit(tmp_path, "c1")
    (tmp_path / "a.txt").write_text("1\n2\n3\n4\n")
    (tmp_path / "d" / "b.py").unlink()
    (tmp_path / "package-lock.json").write_text('{"a":2}\n' * 60)
    _commit(tmp_path, "c2")

    bundle = build_timeline_bundle(str(tmp_path), use_cache=False)

    excluded = {"package-lock.json", "link.txt", "secret/hush.txt"}
    union_paths: set[str] = set()

    def walk_union(n: dict) -> None:
        if n["type"] == "file":
            union_paths.add(n["path"])
        else:
            for ch in n["children"]:
                walk_union(ch)

    walk_union(bundle["unionManifest"]["tree"])
    assert union_paths & excluded == set(), "skipped paths leaked into the union"

    for i, c in enumerate(bundle["commits"]):
        state: dict[str, str] = {}
        for d in bundle["deltas"][: i + 1]:
            for ch in d["changes"]:
                if ch["sha"] is None:
                    state.pop(ch["path"], None)
                else:
                    state[ch["path"]] = ch["sha"]
        assert state.keys() & excluded == set(), f"skipped path replayed at {i}"
        replay = {p: bundle["blobLines"][s] for p, s in state.items()}
        recon = reconstruct_manifest(str(tmp_path), c["sha"], use_cache=False)
        expect: dict[str, int] = {}

        def walk(n: dict) -> None:
            if n["type"] == "file":
                expect[n["path"]] = n["lines"]
            else:
                for ch in n["children"]:
                    walk(ch)

        walk(recon["tree"])
        assert replay == expect, f"mismatch at commit {i}"


def test_bundle_excludes_drop_paths_everywhere(tmp_path: Path) -> None:
    """extra_exclude_paths (the user's city excludes) removes a path from the
    union, every delta, and the blob tables — the same skip filter as
    .codecityignore — so an excluded file is absent everywhere in the bundle.
    Excludes filter changes within each commit, never the commit list itself."""
    from api.services.timeline import build_timeline_bundle

    _init(tmp_path)
    (tmp_path / "keep.txt").write_text("1\n2\n")
    (tmp_path / "secrets").mkdir()
    (tmp_path / "secrets" / "token.txt").write_text("hunter2\n")
    _commit(tmp_path, "c1")
    (tmp_path / "secrets" / "token.txt").write_text("hunter2\nrotated\n")
    _commit(tmp_path, "c2")

    bundle = build_timeline_bundle(
        str(tmp_path), use_cache=False, extra_exclude_paths=frozenset({"secrets"})
    )

    union_paths: set[str] = set()

    def walk(n: dict) -> None:
        if n["type"] == "file":
            union_paths.add(n["path"])
        else:
            for ch in n["children"]:
                walk(ch)

    walk(bundle["unionManifest"]["tree"])
    assert "keep.txt" in union_paths
    assert not any(p.startswith("secrets") for p in union_paths)

    delta_paths = {c["path"] for d in bundle["deltas"] for c in d["changes"]}
    assert not any(p.startswith("secrets") for p in delta_paths)
    assert len(bundle["deltas"]) == len(bundle["commits"]) == 2


def test_bundle_caps_to_recent_window(tmp_path: Path, monkeypatch) -> None:
    from api.services import timeline

    monkeypatch.setattr(timeline, "_UNION_FILE_CAP", 1)  # force the cap
    _init(tmp_path)
    for i in range(4):
        (tmp_path / f"f{i}.txt").write_text("x\n")
        _commit(tmp_path, f"c{i}")
    bundle = timeline.build_timeline_bundle(str(tmp_path), use_cache=False)
    assert bundle["note"] is not None  # windowed, surfaced
    assert len(bundle["commits"]) < 4


def test_bundle_window_never_empty_even_if_newest_commit_alone_exceeds_cap(
    tmp_path: Path, monkeypatch
) -> None:
    """Even a single (newest) commit that alone busts the cap must still leave
    a non-empty timeline, not window itself down to zero commits."""
    from api.services import timeline

    monkeypatch.setattr(timeline, "_UNION_FILE_CAP", 0)  # every commit exceeds this
    _init(tmp_path)
    for i in range(3):
        (tmp_path / f"f{i}.txt").write_text("x\n")
        _commit(tmp_path, f"c{i}")
    bundle = timeline.build_timeline_bundle(str(tmp_path), use_cache=False)
    assert len(bundle["commits"]) >= 1  # never an empty timeline
    assert bundle["note"] is not None
