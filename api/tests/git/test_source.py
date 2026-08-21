"""label_from_source — THE primitive for the repo's display name — plus the
local-path validation that decides whether a directory is scannable at all.

The scanner bakes the label onto tree.name from the git remote (see test_scan);
the manifest route uses it for the pending progress label."""

from __future__ import annotations

import subprocess
import unittest
from unittest import mock
from pathlib import Path
from tempfile import TemporaryDirectory

from api.git import clone, source
from api.utils.labels import label_from_source


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


class WorkingTreeCheckTests(unittest.TestCase):
    def test_it_bypasses_the_ownership_check(self) -> None:
        """Without safe.directory=*, git refuses a repo whose owner isn't the
        process uid — which is EVERY bind-mounted repo in the container, since
        it runs as uid 10001 and the host's files are not. The refusal exits
        non-zero, so this reads as "not a git working tree" and the user is
        told to run `git init` inside a repo that is already fine.

        Asserted on the argv because the failure needs two uids to reproduce,
        which a unit test has no way to arrange."""
        argv = source.git_argv(Path("/repo"), "rev-parse", "--is-inside-work-tree")
        self.assertIn("safe.directory=*", argv)

    def test_a_real_working_tree_is_accepted(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            self.assertTrue(source._is_git_working_tree(root))

    def test_a_plain_directory_is_not(self) -> None:
        with TemporaryDirectory() as tmp:
            self.assertFalse(source._is_git_working_tree(Path(tmp)))


if __name__ == "__main__":
    unittest.main()


class ResolveRootTests(unittest.TestCase):
    """Where a source lives on disk, worked out fresh on every read — the whole
    reason a file read outlives the process that scanned it."""

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        (self.root / "sub").mkdir(parents=True)
        (self.root / ".git").mkdir()
        (self.root / "sub" / "f.txt").write_text("hi")

    def test_local_source_resolves_to_its_directory(self) -> None:
        got = source.get_repo_root(source.SourceRef(str(self.root)))
        self.assertEqual(got, self.root.resolve())

    def test_local_subdirectory_of_a_repo_resolves(self) -> None:
        """The marker is up the tree from a subdirectory, and scanning one is
        allowed, so reading from one has to be."""
        got = source.get_repo_root(source.SourceRef(str(self.root / "sub")))
        self.assertEqual(got, (self.root / "sub").resolve())

    def test_local_source_outside_any_working_tree_is_404(self) -> None:
        plain = Path(self.tmp.name) / "plain"
        plain.mkdir()
        with self.assertRaises(source.ResolveError) as caught:
            source.get_repo_root(source.SourceRef(str(plain)))
        self.assertEqual(caught.exception.status, 404)

    def test_a_linked_worktree_resolves(self) -> None:
        """Its `.git` is a file holding `gitdir: …`, not a directory."""
        wt = Path(self.tmp.name) / "linked"
        wt.mkdir()
        (wt / ".git").write_text(f"gitdir: {self.root}/.git/worktrees/linked\n")
        self.assertEqual(source.get_repo_root(source.SourceRef(str(wt))), wt.resolve())

    def test_local_source_refused_when_local_repos_are_off(self) -> None:
        with mock.patch.object(source, "local_repos_allowed", return_value=False):
            with self.assertRaises(source.ResolveError) as caught:
                source.get_repo_root(source.SourceRef(str(self.root)))
        self.assertEqual(caught.exception.status, 403)

    def test_remote_source_resolves_to_its_clone_dir(self) -> None:
        url = "https://github.com/owner/repo"
        with mock.patch.object(clone, "CLONES_ROOT", Path(self.tmp.name) / "clones"):
            on_disk = source.clone_dir_for(url, "main")
            on_disk.mkdir(parents=True)
            got = source.get_repo_root(source.SourceRef(url, "main"))
            self.assertEqual(got, on_disk.resolve())
            # Keyed on the branch AS PASSED, so the manifest has to echo the one
            # it was built for rather than the branch it resolved to.
            with self.assertRaises(source.ResolveError):
                source.get_repo_root(source.SourceRef(url, None))

    def test_source_that_was_never_cloned_is_404(self) -> None:
        with self.assertRaises(source.ResolveError) as caught:
            source.get_repo_root(source.SourceRef("https://github.com/owner/nope"))
        self.assertEqual(caught.exception.status, 404)

    def test_unrecognized_source_is_400(self) -> None:
        with self.assertRaises(source.ResolveError) as caught:
            source.get_repo_root(source.SourceRef("not-a-source"))
        self.assertEqual(caught.exception.status, 400)


class WithinTests(unittest.TestCase):
    """Containment: the only thing standing between a relative path and the
    rest of the filesystem."""

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = (Path(self.tmp.name) / "repo").resolve()
        (self.root / "sub").mkdir(parents=True)
        (self.root / "sub" / "f.txt").write_text("hi")
        self.outside = Path(self.tmp.name).resolve() / "secret.txt"
        self.outside.write_text("nope")

    def test_path_inside_the_root(self) -> None:
        self.assertEqual(
            source.within(self.root, "sub/f.txt"), self.root / "sub" / "f.txt"
        )

    def test_the_root_itself(self) -> None:
        self.assertEqual(source.within(self.root, "."), self.root)

    def test_dot_dot_escape_refused(self) -> None:
        for escape in ["../secret.txt", "sub/../../secret.txt", str(self.outside)]:
            with self.assertRaises(source.ResolveError) as caught:
                source.within(self.root, escape)
            self.assertEqual(caught.exception.status, 403, escape)

    def test_symlink_out_of_the_root_refused(self) -> None:
        (self.root / "escape.txt").symlink_to(self.outside)
        with self.assertRaises(source.ResolveError) as caught:
            source.within(self.root, "escape.txt")
        self.assertEqual(caught.exception.status, 403)

    def test_missing_path_is_404_when_it_has_to_exist(self) -> None:
        with self.assertRaises(source.ResolveError) as caught:
            source.within(self.root, "sub/gone.txt")
        self.assertEqual(caught.exception.status, 404)

    def test_missing_path_resolves_when_it_need_not_exist(self) -> None:
        """A Timeline blob names a path as it stood at some past commit, so it
        is allowed to be absent — but not to be outside."""
        self.assertEqual(
            source.within(self.root, "sub/gone.txt", must_exist=False),
            self.root / "sub" / "gone.txt",
        )
        with self.assertRaises(source.ResolveError):
            source.within(self.root, "../gone.txt", must_exist=False)


class RepoFileTests(unittest.TestCase):
    """The whole read path in one call: which repo, allowed, present, inside."""

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = (Path(self.tmp.name) / "repo").resolve()
        (self.root / "sub").mkdir(parents=True)
        (self.root / ".git").mkdir()
        (self.root / "sub" / "f.txt").write_text("hi")

    def test_returns_the_repo_and_the_file_in_it(self) -> None:
        found = source.repo_file(source.SourceRef(str(self.root)), "sub/f.txt")
        self.assertEqual(found.root, self.root)
        self.assertEqual(found.path, self.root / "sub" / "f.txt")

    def test_refuses_a_path_out_of_the_repo(self) -> None:
        # A real file outside it: a path that merely does not exist is refused
        # for being absent, which proves nothing about containment.
        (Path(self.tmp.name) / "escape.txt").write_text("nope")
        with self.assertRaises(source.ResolveError) as caught:
            source.repo_file(source.SourceRef(str(self.root)), "../escape.txt")
        self.assertEqual(caught.exception.status, 403)

    def test_a_source_that_is_not_on_disk_never_reaches_containment(self) -> None:
        missing = Path(self.tmp.name) / "gone"
        with self.assertRaises(source.ResolveError) as caught:
            source.repo_file(source.SourceRef(str(missing)), "f.txt")
        self.assertEqual(caught.exception.status, 404)
