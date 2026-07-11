"""Display-label derivation: label_from_source + display_name_for_manifest.

These produce the repo's friendly display name server-side (set onto the
manifest's root tree.name), the single source of truth the frontend reads."""

from __future__ import annotations

import unittest

from api.services.source import display_name_for_manifest, label_from_source


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


class DisplayNameForManifestTests(unittest.TestCase):
    def test_prefers_remote_url_over_display_root(self) -> None:
        # The remote is the canonical identity — it wins over the source URL.
        m = {
            "display_root": "https://github.com/owner/repo",
            "repo": {"remote_url": "https://github.com/other/thing"},
            "tree": {"name": "abc123hash"},
        }
        self.assertEqual(display_name_for_manifest(m), "other/thing")

    def test_local_worktree_uses_remote_name_not_folder(self) -> None:
        # A git worktree: the on-disk folder is a branch-y worktree name, but the
        # remote is the real repo — show the repo name, not the folder.
        m = {
            "display_root": "/Users/me/worktrees/feat-x",
            "repo": {"remote_url": "https://github.com/owner/codecity"},
            "tree": {"name": "feat-x"},
        }
        self.assertEqual(display_name_for_manifest(m), "owner/codecity")

    def test_local_display_root_basename_without_remote(self) -> None:
        # No remote (a bare `git init`): fall back to the folder basename.
        m = {"display_root": "/Users/me/my-repo", "tree": {"name": "my-repo"}}
        self.assertEqual(display_name_for_manifest(m), "my-repo")

    def test_falls_back_to_remote_url(self) -> None:
        # A cloned repo: tree.name is the cache-dir hash; no display_root yet.
        m = {
            "repo": {"remote_url": "git@github.com:owner/repo.git"},
            "tree": {"name": "deadbeefcafe"},
        }
        self.assertEqual(display_name_for_manifest(m), "owner/repo")

    def test_falls_back_to_tree_name(self) -> None:
        m = {"tree": {"name": "raw-name"}}
        self.assertEqual(display_name_for_manifest(m), "raw-name")

    def test_empty_manifest(self) -> None:
        self.assertIsNone(display_name_for_manifest({}))


if __name__ == "__main__":
    unittest.main()
