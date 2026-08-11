"""label_from_source — THE primitive for the repo's display name — plus the
local-path validation that decides whether a directory is scannable at all.

The scanner bakes the label onto tree.name from the git remote (see test_scan);
the manifest route uses it for the pending progress label."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from api.services import source
from api.services.source import label_from_source


class LabelFromSourceTests(unittest.TestCase):
    def test_git_https_url(self) -> None:
        self.assertEqual(
            label_from_source("https://github.com/owner/repo"), "owner/repo"
        )

    def test_git_https_url_dot_git(self) -> None:
        self.assertEqual(
            label_from_source("https://github.com/owner/repo.git"), "owner/repo"
        )

    def test_git_ssh_url(self) -> None:
        self.assertEqual(
            label_from_source("git@github.com:owner/repo.git"), "owner/repo"
        )

    def test_trailing_branch_stripped(self) -> None:
        self.assertEqual(
            label_from_source("https://github.com/owner/repo@main"), "owner/repo"
        )

    def test_local_posix_path_basename(self) -> None:
        self.assertEqual(label_from_source("/Users/me/my-repo"), "my-repo")

    def test_local_posix_trailing_slash(self) -> None:
        self.assertEqual(label_from_source("/Users/me/my-repo/"), "my-repo")

    def test_local_windows_path_basename(self) -> None:
        self.assertEqual(label_from_source(r"C:\code\my-repo"), "my-repo")

    def test_local_relative_path(self) -> None:
        self.assertEqual(label_from_source("./projects/my-repo"), "my-repo")

    def test_empty_and_none(self) -> None:
        self.assertIsNone(label_from_source(""))
        self.assertIsNone(label_from_source(None))


class LocalGitErrorTests(unittest.TestCase):
    """The message is the fix: `just dev` mounts exactly what a deployed
    instance mounts, so a contributor hits this the same way a user does."""

    def test_worktree_names_the_repository_to_open(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").write_text("gitdir: /Users/me/code/proj/.git/worktrees/x\n")
            message = source._local_git_error(root)
            self.assertIn("/Users/me/code/proj", message)
            # The pointer is not something the reader can act on.
            self.assertNotIn("worktrees/x", message)

    def test_worktree_with_an_odd_gitdir_still_names_something_actionable(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").write_text("gitdir: /somewhere/detached\n")
            self.assertIn("/somewhere/detached", source._local_git_error(root))

    def test_plain_directory_keeps_the_git_init_advice(self) -> None:
        with TemporaryDirectory() as tmp:
            self.assertIn("git init", source._local_git_error(Path(tmp)))


class UnreachableWorktreeGitdirTests(unittest.TestCase):
    """A linked worktree mounted without its repository fails the same check as
    a plain directory, and `git init` is the wrong answer for it."""

    def test_missing_gitdir_is_reported(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").write_text("gitdir: /elsewhere/.git/worktrees/feature\n")
            self.assertEqual(
                source._unreachable_worktree_gitdir(root),
                "/elsewhere/.git/worktrees/feature",
            )

    def test_present_gitdir_is_not_a_problem(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            gitdir = root / "real-gitdir"
            gitdir.mkdir()
            (root / ".git").write_text(f"gitdir: {gitdir}\n")
            self.assertIsNone(source._unreachable_worktree_gitdir(root))

    def test_ordinary_checkout_is_not_a_worktree(self) -> None:
        # An ordinary .git is a directory, so there is no pointer to follow and
        # the plain "not a git project" message stands.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").mkdir()
            self.assertIsNone(source._unreachable_worktree_gitdir(root))

    def test_no_git_at_all(self) -> None:
        with TemporaryDirectory() as tmp:
            self.assertIsNone(source._unreachable_worktree_gitdir(Path(tmp)))


if __name__ == "__main__":
    unittest.main()
