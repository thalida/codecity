# src/codecity/analysis/tests/test_git.py
import subprocess
from datetime import datetime
from pathlib import Path

import pytest

from codecity.analysis.git import (
    get_current_branch,
    get_file_git_history,
    get_remote_url,
    get_repo_files,
)


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Create a temporary git repo with some commits."""
    result = subprocess.run(
        ["git", "init"], cwd=tmp_path, capture_output=True, text=True
    )
    assert result.returncode == 0, f"git init failed: {result.stderr}"

    result = subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"git config user.email failed: {result.stderr}"

    result = subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"git config user.name failed: {result.stderr}"

    # Create a file and commit
    test_file = tmp_path / "test.py"
    test_file.write_text("print('hello')\n")

    result = subprocess.run(
        ["git", "add", "test.py"], cwd=tmp_path, capture_output=True, text=True
    )
    assert result.returncode == 0, f"git add failed: {result.stderr}"

    result = subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"git commit failed: {result.stderr}"

    return tmp_path


def test_get_repo_files_returns_tracked_files(git_repo: Path) -> None:
    files = get_repo_files(git_repo)
    assert "test.py" in files


def test_get_repo_files_excludes_untracked(git_repo: Path) -> None:
    (git_repo / "untracked.py").write_text("# untracked\n")
    files = get_repo_files(git_repo)
    assert "untracked.py" not in files


def test_get_file_git_history_returns_dates(git_repo: Path) -> None:
    history = get_file_git_history(git_repo, "test.py")
    assert "created_at" in history
    assert "last_modified" in history
    assert isinstance(history["created_at"], datetime)
    assert isinstance(history["last_modified"], datetime)


def test_get_current_branch_returns_branch_name(git_repo: Path) -> None:
    """Test that get_current_branch returns 'main' or 'master'."""
    branch = get_current_branch(git_repo)
    assert branch in ("main", "master"), f"Expected 'main' or 'master', got '{branch}'"


def test_get_remote_url_returns_none_when_no_remote(git_repo: Path) -> None:
    """Test that get_remote_url returns None when no remote exists."""
    url = get_remote_url(git_repo)
    assert url is None


def test_last_modified_changes_after_file_modification(git_repo: Path) -> None:
    """Test that last_modified is different from created_at after modification."""
    import time

    # Get initial history
    initial_history = get_file_git_history(git_repo, "test.py")
    created_at = initial_history["created_at"]

    # Wait a small amount to ensure different timestamp
    time.sleep(1)

    # Modify the file and commit again
    test_file = git_repo / "test.py"
    test_file.write_text("print('hello world')\n")

    result = subprocess.run(
        ["git", "add", "test.py"], cwd=git_repo, capture_output=True, text=True
    )
    assert result.returncode == 0, f"git add failed: {result.stderr}"

    result = subprocess.run(
        ["git", "commit", "-m", "Modify test file"],
        cwd=git_repo,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"git commit failed: {result.stderr}"

    # Get updated history
    updated_history = get_file_git_history(git_repo, "test.py")
    last_modified = updated_history["last_modified"]

    # Verify last_modified is different from created_at
    assert (
        last_modified != created_at
    ), "last_modified should be different from created_at after modification"
    assert last_modified > created_at, "last_modified should be after created_at"
