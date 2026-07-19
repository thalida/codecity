# api/tests/test_scan_dirty.py
from api.services.scan import _parse_dirty_paths


def test_parse_dirty_paths_reads_modified_and_staged_skips_untracked():
    # git status --porcelain -z format: "XY <path>\0", renames "R  <new>\0<old>\0".
    z = (
        "\0".join(
            [
                " M api/services/scan.py",  # unstaged modification
                "A  api/new_staged.py",  # staged addition
                "?? scratch.txt",  # untracked -> excluded
                "!! build/artifact",  # ignored -> excluded
            ]
        )
        + "\0"
    )
    assert _parse_dirty_paths(z) == {"api/services/scan.py", "api/new_staged.py"}


def test_parse_dirty_paths_rename_takes_destination():
    z = "R  api/renamed_to.py\0api/renamed_from.py\0"
    assert _parse_dirty_paths(z) == {"api/renamed_to.py"}


def test_parse_dirty_paths_empty():
    assert _parse_dirty_paths("") == set()


import subprocess
from pathlib import Path
from api.services.scan import scan_tree
from api.services.manifest_types import Manifest


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def _final_manifest(root: str, **kwargs) -> Manifest:
    """Drain scan_tree() (a streaming generator) and return the final-phase
    manifest — mirrors test_scan.py's helper of the same name."""
    final: Manifest | None = None
    for event in scan_tree(root, **kwargs):
        if event["phase"] == "manifest-complete":
            final = event["manifest"]
    assert final is not None, "scan_tree must yield a final event"
    return final


def test_dirty_file_uses_worktree_mtime_and_flag(tmp_path: Path):
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    f = tmp_path / "a.py"
    f.write_text("x = 1\n")
    _git(tmp_path, "add", "a.py")
    _git(tmp_path, "commit", "-qm", "init")
    clean = tmp_path / "b.py"
    clean.write_text("y = 2\n")
    _git(tmp_path, "add", "b.py")
    _git(tmp_path, "commit", "-qm", "b")
    # Now dirty a.py in the working tree (uncommitted).
    f.write_text("x = 1\nx = 2\nx = 3\n")

    manifest = _final_manifest(str(tmp_path), use_cache=False)
    nodes = {n["path"]: n for n in manifest["tree"]["children"]}
    assert nodes["a.py"]["dirty"] is True
    assert nodes["b.py"]["dirty"] is False
    # a.py grew — its modified date reflects the working-tree write, so it is
    # >= b.py's commit date (a.py was committed BEFORE b.py, so a git-history
    # modified would be OLDER than b.py; the override flips that).
    assert nodes["a.py"]["modified"] >= nodes["b.py"]["modified"]
    assert manifest["repo"]["dirty"] is True


def test_dirty_file_count_matches_flags(tmp_path: Path):
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    (tmp_path / "a.py").write_text("1\n")
    (tmp_path / "b.py").write_text("2\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "init")
    (tmp_path / "a.py").write_text("1\n2\n")  # dirty one file
    manifest = _final_manifest(str(tmp_path), use_cache=False)
    assert manifest["stats"]["dirtyFileCount"] == 1
