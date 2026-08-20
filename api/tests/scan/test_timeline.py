"""Tests for api/scan/timeline.py — the per-commit blob-delta walk
that the client replays to reconstruct any commit's file set."""

import os
import subprocess
from pathlib import Path
from api.models.manifest import DateRangeMs, RangeStat

from api.scan.timeline import walk_deltas


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
    from api.scan.scanner import reconstruct_manifest

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
        if n.type == "file":
            recon_paths.add(n.path)
        else:
            for ch in n.children:
                walk(ch)

    walk(recon.tree)
    assert "x.txt" not in recon_paths
    assert set(state) == recon_paths


def test_a_blob_the_backfill_skipped_reads_as_unknown_not_empty(tmp_path: Path) -> None:
    """A blob over the hydrate cap is never fetched, so its size and line count
    are not recoverable locally. Reporting 0 there makes a file with real content
    indistinguishable from an empty one, and draws it as the smallest building
    in the city."""
    from api.scan.timeline import (
        walk_deltas,
        build_union_manifest,
        _collect_blob_tables,
    )
    from api.git.meta import collect_git_history

    _init(tmp_path)
    (tmp_path / "small.txt").write_text("one\ntwo\n")
    (tmp_path / "huge.bin").write_bytes(b"real content, just too big to backfill\n")
    _commit(tmp_path, "c1")

    deltas = walk_deltas(tmp_path)
    lines, sizes, blob_stats = _collect_blob_tables(tmp_path, deltas)
    created, modified, commits = collect_git_history(tmp_path, use_cache=False)

    # Stand in for the skip: the tables simply have no entry for that blob,
    # which is exactly what GIT_NO_LAZY_FETCH leaves behind for one over the cap.
    huge_sha = next(
        sha for d in deltas for path, sha in d.changes if path == "huge.bin" and sha
    )
    sizes.pop(huge_sha)
    lines.pop(huge_sha, None)
    blob_stats.pop(huge_sha, None)

    m = build_union_manifest(
        tmp_path, deltas, lines, sizes, blob_stats, commits, created, modified
    )
    nodes: dict[str, object] = {}

    def walk(n) -> None:
        if n.type == "file":
            nodes[n.path] = n
        else:
            for c in n.children:
                walk(c)

    walk(m.tree)
    # Still in the city: it existed, we just cannot measure it.
    assert set(nodes) == {"small.txt", "huge.bin"}
    assert nodes["huge.bin"].size is None
    assert nodes["huge.bin"].lines is None
    # The measurable file beside it is unaffected.
    assert nodes["small.txt"].size == len("one\ntwo\n")
    assert nodes["small.txt"].lines == 2


def test_unmeasurable_file_stays_out_of_totals_and_superlatives(
    tmp_path: Path,
) -> None:
    """It counts as a file, but a byte total that silently included it as 0
    would read as complete, and a superlative would crown the wrong file."""
    from api.scan.stats import compute_repo_stats
    from api.scan.timeline import (
        walk_deltas,
        build_union_manifest,
        _collect_blob_tables,
    )
    from api.git.meta import collect_git_history

    _init(tmp_path)
    (tmp_path / "known.txt").write_text("a\nb\nc\n")
    (tmp_path / "unknown.bin").write_bytes(b"x" * 500)
    _commit(tmp_path, "c1")

    deltas = walk_deltas(tmp_path)
    lines, sizes, blob_stats = _collect_blob_tables(tmp_path, deltas)
    created, modified, commits = collect_git_history(tmp_path, use_cache=False)
    unknown_sha = next(
        sha for d in deltas for path, sha in d.changes if path == "unknown.bin" and sha
    )
    sizes.pop(unknown_sha)
    lines.pop(unknown_sha, None)
    blob_stats.pop(unknown_sha, None)

    m = build_union_manifest(
        tmp_path, deltas, lines, sizes, blob_stats, commits, created, modified
    )
    stats = compute_repo_stats(m.tree, commits)

    # Not folded into a byte range that would then read as the whole repo.
    assert stats.byteSizeRange.max == len("a\nb\nc\n")
    # And it cannot win "widest", which it would at its real 500 bytes and
    # would silently have lost at a fabricated 0.
    assert stats.maxBytesFile is not None
    assert stats.maxBytesFile.path == "known.txt"
    # The directory rollup counts the file without claiming its bytes.
    assert m.tree.descendants_file_count == 2
    assert m.tree.descendants_size == len("a\nb\nc\n")


def test_union_manifest_is_all_paths_max_size(tmp_path: Path) -> None:
    from api.scan.timeline import (
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
    from api.git.meta import collect_git_history

    created, modified, commits = collect_git_history(tmp_path, use_cache=False)
    m = build_union_manifest(
        tmp_path, deltas, lines, sizes, blob_stats, commits, created, modified
    )

    nodes: dict[str, dict] = {}

    def walk(n: dict) -> None:
        if n.type == "file":
            nodes[n.path] = n
        else:
            for c in n.children:
                walk(c)

    walk(m.tree)
    assert set(nodes) == {"a.txt", "gone.txt", "app.db"}  # deleted file is in the union
    assert nodes["a.txt"].size == len("x\ny\nz\n")  # MAX size over history
    assert m.repo.dirty is False
    assert "T" in nodes["a.txt"].created  # full ISO timestamp, not day-precision
    assert "T" in nodes["a.txt"].modified
    # Regression: a binary file must carry binary/binaryType in the union manifest
    # too (was hardcoded binary=False), so Timeline renders it as a data building.
    assert nodes["app.db"].binary is True
    assert nodes["app.db"].binaryType == "SQLite database"
    assert nodes["a.txt"].binary is False


def test_union_manifest_keeps_every_commit(tmp_path: Path, monkeypatch) -> None:
    """The scrubber indexes the bundle's commits and the city the union
    manifest's, so the union manifest must never be sampled."""
    from api.scan.timeline import (
        walk_deltas,
        build_union_manifest,
        _collect_blob_tables,
    )
    from api.git.meta import collect_git_history

    _init(tmp_path)
    for i in range(4):
        (tmp_path / f"f{i}.txt").write_text("x\n")
        _commit(tmp_path, f"c{i}")

    monkeypatch.setattr("api.scan.manifest.MAX_WIRE_COMMITS", 1)
    deltas = walk_deltas(tmp_path)
    lines, sizes, blob_stats = _collect_blob_tables(tmp_path, deltas)
    created, modified, commits = collect_git_history(tmp_path, use_cache=False)
    m = build_union_manifest(
        tmp_path, deltas, lines, sizes, blob_stats, commits, created, modified
    )
    assert len(m.commits) == len(commits) == 4


def test_compute_commit_line_ranges() -> None:
    """Per-commit range tracks the present set: files add/grow/delete, and
    zero-line files (binary/empty) are excluded — mirroring compute_repo_stats."""
    from api.scan.timeline import CommitDelta, compute_commit_line_ranges

    blob_lines = {"a1": 3, "a2": 10, "b1": 5, "bin": 0, "empty": 0}
    deltas = [
        CommitDelta("c1", [("a.txt", "a1")]),  # a=3 present
        CommitDelta("c2", [("a.txt", "a2"), ("b.txt", "b1")]),  # a=10, b=5
        CommitDelta("c3", [("d.bin", "bin"), ("e.txt", "empty")]),  # +0-line files
        CommitDelta("c4", [("a.txt", None)]),  # a.txt deleted → only b=5 present
    ]
    assert compute_commit_line_ranges(deltas, blob_lines) == [
        RangeStat(min=3, max=3),
        RangeStat(min=5, max=10),
        RangeStat(min=5, max=10),  # binary + empty (0 lines) excluded
        RangeStat(min=5, max=5),  # a.txt gone
    ]


def test_head_line_range_matches_live_scan(tmp_path: Path) -> None:
    """The core Timeline-HEAD-equals-Live contract: commitLineRanges[-1] (HEAD)
    equals the live scan's stats.lineCountRange for the same repo — same exact
    counter on both paths, same present set, so height normalizes identically."""
    from api.scan.timeline import (
        walk_deltas,
        _collect_blob_tables,
        compute_commit_line_ranges,
    )
    from api.scan.scanner import scan_tree

    _init(tmp_path)
    (tmp_path / "a.txt").write_text("l1\nl2\nl3\n")  # 3 lines
    (tmp_path / "b.txt").write_text("only one line, no newline")  # 1 line
    (tmp_path / "big.txt").write_text("x\n" * 100)  # 100 lines
    (tmp_path / "data.bin").write_bytes(b"\x00\x01\x02" * 500)  # binary → 0, excluded
    _commit(tmp_path, "c1")

    live = None
    for ev in scan_tree(str(tmp_path), use_cache=False):
        if ev.phase == "manifest-complete":
            live = ev.manifest
    assert live is not None
    live_range = live.stats.lineCountRange

    deltas = walk_deltas(tmp_path)
    blob_lines, _sizes, _stats = _collect_blob_tables(tmp_path, deltas, use_cache=False)
    ranges = compute_commit_line_ranges(deltas, blob_lines)

    assert live_range == RangeStat(min=1, max=100)  # b=1, big=100; binary excluded
    assert ranges[-1] == live_range  # Timeline HEAD == Live


def test_head_date_range_matches_live_scan(tmp_path: Path) -> None:
    """The date analog of the line-range contract: commitDateRanges[-1] (HEAD)
    equals the live scan's dateRanges for the same repo, so weathering at HEAD
    normalizes identically. Compared as epoch ms, which is what the client
    consumes."""
    from api.scan.timeline import compute_commit_date_ranges, walk_deltas
    from api.utils.dates import iso_to_ms
    from api.git.meta import collect_git_history
    from api.scan.scanner import scan_tree

    _init(tmp_path)
    (tmp_path / "a.txt").write_text("one\n")
    _commit(tmp_path, "c1")
    (tmp_path / "b.txt").write_text("two\n")
    _commit(tmp_path, "c2")
    (tmp_path / "a.txt").write_text("one\nmore\n")
    _commit(tmp_path, "c3")

    live = None
    for ev in scan_tree(str(tmp_path), use_cache=False):
        if ev.phase == "manifest-complete":
            live = ev.manifest
    assert live is not None
    live_dates = live.dateRanges

    deltas = walk_deltas(tmp_path)
    git_created, git_modified, commits = collect_git_history(tmp_path, use_cache=False)
    ranges = compute_commit_date_ranges(deltas, commits, git_created, git_modified)

    assert ranges[-1] == DateRangeMs(
        minCreated=iso_to_ms(live_dates.minCreated),
        maxCreated=iso_to_ms(live_dates.maxCreated),
        minModified=iso_to_ms(live_dates.minModified),
        maxModified=iso_to_ms(live_dates.maxModified),
    )
    # One range per commit, and the created span never runs backwards.
    assert len(ranges) == len(deltas)
    assert all(r.minCreated <= r.maxCreated for r in ranges)


def test_commit_date_ranges_track_the_present_set(tmp_path: Path) -> None:
    """A deleted file drops out of the range at the commit that removed it."""
    from api.scan.timeline import compute_commit_date_ranges, walk_deltas
    from api.git.meta import collect_git_history

    _init(tmp_path)
    (tmp_path / "old.txt").write_text("x\n")
    _commit(tmp_path, "c1")
    (tmp_path / "new.txt").write_text("y\n")
    _commit(tmp_path, "c2")
    (tmp_path / "old.txt").unlink()
    _commit(tmp_path, "c3")

    deltas = walk_deltas(tmp_path)
    git_created, git_modified, commits = collect_git_history(tmp_path, use_cache=False)
    ranges = compute_commit_date_ranges(deltas, commits, git_created, git_modified)

    # At c1 only old.txt exists, so the span is a single instant.
    assert ranges[0].minCreated == ranges[0].maxCreated
    # At HEAD only new.txt survives, so its creation is both ends again.
    assert ranges[-1].minCreated == ranges[-1].maxCreated


def test_bundle_replay_matches_reconstruct(tmp_path: Path) -> None:
    """Replaying deltas[0..i] reproduces reconstruct_manifest's file set + lines
    at that ref — ties the bundle to the proven phase-1 reconstruction. The
    fixture commits paths the live scan drops (ALWAYS_SKIP lockfile, a symlink,
    a .codecityignore entry) to guard that the timeline path applies the
    identical skip filter at every commit."""
    from api.scan.timeline import build_timeline_bundle
    from api.scan.scanner import reconstruct_manifest

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
        if n.type == "file":
            union_paths.add(n.path)
        else:
            for ch in n.children:
                walk_union(ch)

    walk_union(bundle.unionManifest.tree)
    assert union_paths & excluded == set(), "skipped paths leaked into the union"

    for i, c in enumerate(bundle.commits):
        state: dict[str, str] = {}
        for d in bundle.deltas[: i + 1]:
            for ch in d.changes:
                if ch.sha is None:
                    state.pop(ch.path, None)
                else:
                    state[ch.path] = ch.sha
        assert state.keys() & excluded == set(), f"skipped path replayed at {i}"
        replay = {p: bundle.blobLines[s] for p, s in state.items()}
        recon = reconstruct_manifest(str(tmp_path), c.sha, use_cache=False)
        expect: dict[str, int] = {}

        def walk(n: dict) -> None:
            if n.type == "file":
                expect[n.path] = n.lines
            else:
                for ch in n.children:
                    walk(ch)

        walk(recon.tree)
        assert replay == expect, f"mismatch at commit {i}"


def test_bundle_excludes_drop_paths_everywhere(tmp_path: Path) -> None:
    """extra_exclude_paths (the user's city excludes) removes a path from the
    union, every delta, and the blob tables — the same skip filter as
    .codecityignore — so an excluded file is absent everywhere in the bundle.
    Excludes filter changes within each commit, never the commit list itself."""
    from api.scan.timeline import build_timeline_bundle

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
        if n.type == "file":
            union_paths.add(n.path)
        else:
            for ch in n.children:
                walk(ch)

    walk(bundle.unionManifest.tree)
    assert "keep.txt" in union_paths
    assert not any(p.startswith("secrets") for p in union_paths)

    delta_paths = {c.path for d in bundle.deltas for c in d.changes}
    assert not any(p.startswith("secrets") for p in delta_paths)
    assert len(bundle.deltas) == len(bundle.commits) == 2


def test_bundle_caps_to_recent_window(tmp_path: Path, monkeypatch) -> None:
    from api.scan import timeline

    monkeypatch.setattr(timeline, "_UNION_FILE_CAP", 1)  # force the cap
    _init(tmp_path)
    for i in range(4):
        (tmp_path / f"f{i}.txt").write_text("x\n")
        _commit(tmp_path, f"c{i}")
    bundle = timeline.build_timeline_bundle(str(tmp_path), use_cache=False)
    assert bundle.notes  # windowed, surfaced
    assert len(bundle.commits) < 4


def test_bundle_window_never_empty_even_if_newest_commit_alone_exceeds_cap(
    tmp_path: Path, monkeypatch
) -> None:
    """Even a single (newest) commit that alone busts the cap must still leave
    a non-empty timeline, not window itself down to zero commits."""
    from api.scan import timeline

    monkeypatch.setattr(timeline, "_UNION_FILE_CAP", 0)  # every commit exceeds this
    _init(tmp_path)
    for i in range(3):
        (tmp_path / f"f{i}.txt").write_text("x\n")
        _commit(tmp_path, f"c{i}")
    bundle = timeline.build_timeline_bundle(str(tmp_path), use_cache=False)
    assert len(bundle.commits) >= 1  # never an empty timeline
    assert bundle.notes
