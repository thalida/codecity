"""Unit coverage for list_remote_branches (git ls-remote parsing)."""

from __future__ import annotations

from pathlib import Path

import pytest

from api.services.clone import (
    RepoNotFoundError,
    _parse_ls_remote,
    list_remote_branches,
)

_SHA = "12b2db409bb1115d3c5328fc7966dc035e2305a4"


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


def test_symref_head_wins() -> None:
    # When the server advertises a symbolic HEAD, that is the default.
    stdout = (
        f"ref: refs/heads/main\tHEAD\n"
        f"{_SHA}\tHEAD\n"
        f"{_SHA}\trefs/heads/main\n"
        f"{_SHA}\trefs/heads/develop\n"
    )
    branches, default = _parse_ls_remote(stdout)
    assert branches == ["main", "develop"]
    assert default == "main"


def test_lone_branch_is_default_without_head() -> None:
    # The reported Forgejo case: no symref HEAD advertised, one branch → that
    # branch is unambiguously the default (was returning None before).
    branches, default = _parse_ls_remote(f"{_SHA}\trefs/heads/develop\n")
    assert branches == ["develop"]
    assert default == "develop"


def test_conventional_name_default_without_head() -> None:
    # No symref HEAD + multiple branches → prefer a conventional default name.
    _, default = _parse_ls_remote(
        f"{_SHA}\trefs/heads/develop\n{_SHA}\trefs/heads/main\n"
    )
    assert default == "main"
    # develop wins when neither main nor master is present.
    _, default = _parse_ls_remote(
        f"{_SHA}\trefs/heads/develop\n{_SHA}\trefs/heads/feature-x\n"
    )
    assert default == "develop"


def test_no_head_no_convention_stays_none() -> None:
    # Can't guess when nothing conventional is present — leave it unselected.
    branches, default = _parse_ls_remote(
        f"{_SHA}\trefs/heads/foo\n{_SHA}\trefs/heads/bar\n"
    )
    assert branches == ["foo", "bar"]
    assert default is None
