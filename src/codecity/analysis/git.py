# src/codecity/analysis/git.py
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict


class GitHistoryDict(TypedDict):
    created_at: datetime
    last_modified: datetime


def get_repo_files(repo_path: Path) -> list[str]:
    """Get list of all tracked files in the repository."""
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []

    return [f for f in result.stdout.strip().split("\n") if f]


def get_file_git_history(repo_path: Path, file_path: str) -> GitHistoryDict:
    """Get creation and last modification dates from git history."""
    now = datetime.now(timezone.utc)

    # Get first commit date (creation)
    result = subprocess.run(
        ["git", "log", "--diff-filter=A", "--follow", "--format=%aI", "--", file_path],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        lines = result.stdout.strip().split("\n")
        created_at = datetime.fromisoformat(lines[-1])
    else:
        created_at = now

    # Get last commit date (modification)
    result = subprocess.run(
        ["git", "log", "-1", "--format=%aI", "--", file_path],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        last_modified = datetime.fromisoformat(result.stdout.strip())
    else:
        last_modified = now

    return {
        "created_at": created_at,
        "last_modified": last_modified,
    }


def get_current_branch(repo_path: Path) -> str:
    """Get the current branch name."""
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return "main"


def get_remote_url(repo_path: Path) -> str | None:
    """Get the origin remote URL if it exists."""
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return None
