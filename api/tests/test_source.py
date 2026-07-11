"""label_from_source — THE primitive for the repo's display name.

The scanner bakes it onto tree.name from the git remote (see test_scan); the
manifest route uses it for the pending progress label. This covers the pure
URL/path → "owner/repo" | basename transform."""

from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()
