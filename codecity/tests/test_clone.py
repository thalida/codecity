"""Tests for codecity.clone — the read-only clone-or-update helper.

Uses a local bare repo as the "remote" so tests don't hit the network.
``CACHE_ROOT`` is monkey-patched to a per-test tempdir so we never touch
the user's real ``~/.cache/codecity/``.
"""

from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from codecity import clone as clone_mod
from codecity.clone import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    _maybe_raise_clean_clone_error,
    ensure_clone,
)


os.environ["CODECITY_QUIET"] = "1"


def _run(*args: str, cwd: Path) -> None:
    subprocess.run(args, cwd=str(cwd), check=True, capture_output=True)


def _make_fake_remote(tmp: Path) -> tuple[Path, str]:
    """Build a tiny bare repo at ``tmp/remote.git`` with one initial commit
    on a 'main' branch and a 'feature' branch carrying a different file.
    Returns (remote_path, default_branch_name)."""
    work = tmp / "work"
    work.mkdir()
    _run("git", "init", "-q", "--initial-branch=main", cwd=work)
    _run("git", "config", "user.email", "test@example.com", cwd=work)
    _run("git", "config", "user.name", "Test", cwd=work)
    (work / "README.md").write_text("hello\n")
    _run("git", "add", "README.md", cwd=work)
    _run("git", "commit", "-q", "-m", "initial", cwd=work)
    _run("git", "checkout", "-q", "-b", "feature", cwd=work)
    (work / "FEATURE.md").write_text("on feature branch\n")
    _run("git", "add", "FEATURE.md", cwd=work)
    _run("git", "commit", "-q", "-m", "feature commit", cwd=work)
    _run("git", "checkout", "-q", "main", cwd=work)

    bare = tmp / "remote.git"
    _run("git", "clone", "-q", "--bare", str(work), str(bare), cwd=tmp)
    # Mark HEAD on the bare so symbolic-ref resolution works post-clone.
    _run("git", "symbolic-ref", "HEAD", "refs/heads/main", cwd=bare)
    return bare, "main"


class EnsureCloneTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tmp_path = Path(self.tmp.name)

        self.cache = self.tmp_path / "cache"
        self.cache_patch = mock.patch.object(clone_mod, "CACHE_ROOT", self.cache)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)

        self.remote, self.default_branch = _make_fake_remote(self.tmp_path)
        self.url = str(self.remote)

    def test_first_call_clones(self) -> None:
        local = ensure_clone(self.url)
        self.assertTrue(local.is_dir())
        self.assertTrue((local / ".git").is_dir())
        self.assertTrue((local / "README.md").is_file())

    def test_second_call_reuses_directory(self) -> None:
        first = ensure_clone(self.url)
        # Drop a sentinel file; if a reclone happened it would survive (we
        # reset --hard) but the marker we want is "no second .git inside".
        # Instead: verify the local path is identical and git rev-parse
        # still points at origin/main.
        second = ensure_clone(self.url)
        self.assertEqual(first, second)
        head = subprocess.run(
            ["git", "-C", str(second), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        self.assertTrue(head)

    def test_update_picks_up_remote_commits(self) -> None:
        local = ensure_clone(self.url)
        # Add a new commit to the bare via a temporary worktree on the remote.
        scratch = self.tmp_path / "scratch"
        _run("git", "clone", "-q", str(self.remote), str(scratch), cwd=self.tmp_path)
        _run("git", "config", "user.email", "test@example.com", cwd=scratch)
        _run("git", "config", "user.name", "Test", cwd=scratch)
        (scratch / "NEW.md").write_text("new file\n")
        _run("git", "add", "NEW.md", cwd=scratch)
        _run("git", "commit", "-q", "-m", "new", cwd=scratch)
        _run("git", "push", "-q", "origin", "main", cwd=scratch)

        ensure_clone(self.url)
        self.assertTrue((local / "NEW.md").is_file())

    def test_branch_picks_named_branch(self) -> None:
        local = ensure_clone(self.url, branch="feature")
        self.assertTrue((local / "FEATURE.md").is_file())
        # Different (url, branch) gets a different cache directory than no-branch.
        default = ensure_clone(self.url)
        self.assertNotEqual(local, default)

    def test_missing_remote_raises_clone_error(self) -> None:
        with self.assertRaises(CloneError):
            ensure_clone(str(self.tmp_path / "does-not-exist.git"))


class CleanCloneErrorDispatcherTests(unittest.TestCase):
    def test_branch_not_found_first_clone_stderr(self) -> None:
        with self.assertRaises(BranchNotFoundError) as ctx:
            _maybe_raise_clean_clone_error(
                "https://example.com/x.git",
                "feature-x",
                "fatal: Remote branch feature-x not found in upstream origin",
            )
        self.assertIn("feature-x", str(ctx.exception))

    def test_branch_not_found_reset_stderr(self) -> None:
        with self.assertRaises(BranchNotFoundError):
            _maybe_raise_clean_clone_error(
                "https://example.com/x.git",
                "feature-x",
                "fatal: ambiguous argument 'origin/feature-x': "
                "unknown revision or path not in the working tree.",
            )

    def test_repo_not_found(self) -> None:
        with self.assertRaises(RepoNotFoundError):
            _maybe_raise_clean_clone_error(
                "https://example.com/x.git",
                None,
                "ERROR: Repository not found.\n"
                "fatal: Could not read from remote repository.",
            )

    def test_host_unreachable(self) -> None:
        with self.assertRaises(HostUnreachableError):
            _maybe_raise_clean_clone_error(
                "https://no-such-host.example/x.git",
                None,
                "fatal: unable to access 'https://no-such-host.example/x.git/': "
                "Could not resolve host: no-such-host.example",
            )

    def test_auth_failure_passes_through(self) -> None:
        # Auth failures are NOT translated. Caller sees no exception from
        # the dispatcher — generic CloneError propagates from elsewhere.
        result = _maybe_raise_clean_clone_error(
            "https://example.com/x.git",
            None,
            "fatal: Authentication failed for 'https://example.com/x.git/'",
        )
        self.assertIsNone(result)

    def test_subclass_relationship(self) -> None:
        self.assertTrue(issubclass(BranchNotFoundError, CloneError))
        self.assertTrue(issubclass(RepoNotFoundError, CloneError))
        self.assertTrue(issubclass(HostUnreachableError, CloneError))


if __name__ == "__main__":
    unittest.main()
