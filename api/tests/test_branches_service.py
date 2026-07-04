"""Unit coverage for list_remote_branches (git ls-remote parsing)."""

from __future__ import annotations

from pathlib import Path

import pytest

from api.services.clone import RepoNotFoundError, list_remote_branches


def test_lists_heads_and_default(make_fake_remote, tmp_path: Path) -> None:
    bare, _ = make_fake_remote(tmp_path)  # bare repo, HEAD → main, has 'feature' too
    branches, resolved_default = list_remote_branches(f"file://{bare}")
    assert "main" in branches
    assert "feature" in branches
    assert resolved_default == "main"
    # Only heads, no tags/HEAD pseudo-refs leak in.
    assert all("/" not in b for b in branches)


def test_bogus_url_raises(tmp_path: Path) -> None:
    with pytest.raises((RepoNotFoundError, Exception)):
        list_remote_branches(f"file://{tmp_path / 'nope.git'}")
