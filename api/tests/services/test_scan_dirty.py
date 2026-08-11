import inspect
import os
import subprocess
from pathlib import Path

from api.services.gitmeta import collect_git_state, parse_dirty_paths
from api.services.scan import signature_tree
from api.services.signatures import hash_repo_info
from api.tests.conftest import final_manifest as _final_manifest


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
    assert parse_dirty_paths(z) == {"api/services/scan.py", "api/new_staged.py"}


def test_parse_dirty_paths_rename_takes_destination():
    z = "R  api/renamed_to.py\0api/renamed_from.py\0"
    assert parse_dirty_paths(z) == {"api/renamed_to.py"}


def test_parse_dirty_paths_worktree_rename_takes_destination():
    # Worktree-side rename (X=space, Y=R): the source field still follows.
    z = " R api/renamed_to.py\0api/renamed_from.py\0"
    assert parse_dirty_paths(z) == {"api/renamed_to.py"}


def test_parse_dirty_paths_empty():
    assert parse_dirty_paths("") == set()


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def test_collect_git_state_one_snapshot(tmp_path: Path):
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    (tmp_path / "a.py").write_text("1\n")
    (tmp_path / "b.py").write_text("2\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "init")
    (tmp_path / "a.py").write_text("1\n2\n")  # dirty one file

    state = collect_git_state(tmp_path)
    assert "a.py" in state.tracked and "b.py" in state.tracked
    assert state.dirty == {"a.py"}
    assert state.repo["dirty"] is True
    assert state.repo["branch"] in ("main", "master")


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


def testhash_repo_info_has_no_repo_level_dirty_set_param():
    # Dirtiness is per-file, so a repo-wide dirty_paths set would recompute the
    # signature for every file whenever any one of them changed.
    assert list(inspect.signature(hash_repo_info).parameters) == ["sig", "repo_info"]


def test_mode_only_change_moves_signature(tmp_path: Path):
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    _git(tmp_path, "config", "core.fileMode", "true")
    f = tmp_path / "s.sh"
    f.write_text("echo hi\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "i")
    sig1 = signature_tree(str(tmp_path))["content_signature"]
    os.chmod(f, 0o755)  # dirty via mode only: size + mtime unchanged
    sig2 = signature_tree(str(tmp_path))["content_signature"]
    assert sig1 != sig2  # per-file dirty bit is in the signature
