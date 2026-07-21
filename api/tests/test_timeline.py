"""Tests for api/services/timeline.py — the per-commit blob-delta walk
that the client replays to reconstruct any commit's file set."""

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
    _commit(tmp_path, "c2")
    (tmp_path / "gone.txt").unlink()  # deleted, still in union
    _commit(tmp_path, "c3")

    deltas = walk_deltas(tmp_path)
    lines, sizes = _collect_blob_tables(tmp_path, deltas)
    from api.services.scan import _collect_git_history

    created, modified, commits = _collect_git_history(tmp_path, use_cache=False)
    m = build_union_manifest(tmp_path, deltas, lines, sizes, commits, created, modified)

    nodes: dict[str, dict] = {}

    def walk(n: dict) -> None:
        if n["type"] == "file":
            nodes[n["path"]] = n
        else:
            for c in n["children"]:
                walk(c)

    walk(m["tree"])
    assert set(nodes) == {"a.txt", "gone.txt"}  # deleted file is in the union
    assert nodes["a.txt"]["size"] == len("x\ny\nz\n")  # MAX size over history
    assert m["repo"]["dirty"] is False
    assert "T" in nodes["a.txt"]["created"]  # full ISO timestamp, not day-precision
    assert "T" in nodes["a.txt"]["modified"]


def test_bundle_replay_matches_reconstruct(tmp_path: Path) -> None:
    """Replaying deltas[0..i] reproduces reconstruct_manifest's file set + lines
    at that ref — ties the bundle to the proven phase-1 reconstruction."""
    from api.services.timeline import build_timeline_bundle
    from api.services.scan import reconstruct_manifest

    _init(tmp_path)
    (tmp_path / "a.txt").write_text("1\n2\n")
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "b.py").write_text("x=1\n")
    _commit(tmp_path, "c1")
    (tmp_path / "a.txt").write_text("1\n2\n3\n4\n")
    (tmp_path / "d" / "b.py").unlink()
    _commit(tmp_path, "c2")

    bundle = build_timeline_bundle(str(tmp_path), use_cache=False)
    for i, c in enumerate(bundle["commits"]):
        state: dict[str, str] = {}
        for d in bundle["deltas"][: i + 1]:
            for ch in d["changes"]:
                if ch["sha"] is None:
                    state.pop(ch["path"], None)
                else:
                    state[ch["path"]] = ch["sha"]
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
