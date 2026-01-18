# src/codecity/analysis/tests/test_git.py
import subprocess
from datetime import datetime
from pathlib import Path

import pytest

from codecity.analysis.git import get_file_git_history, get_repo_files


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Create a temporary git repo with some commits."""
    subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=tmp_path,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=tmp_path,
        capture_output=True,
    )

    # Create a file and commit
    test_file = tmp_path / "test.py"
    test_file.write_text("print('hello')\n")
    subprocess.run(["git", "add", "test.py"], cwd=tmp_path, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=tmp_path,
        capture_output=True,
    )

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
