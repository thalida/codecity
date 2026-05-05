"""Unit tests for codecity/scan.py."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from codecity.scan import (
    _extension,
    _is_binary,
    scan_tree,
    signature_tree,
)


# Silence progress logs during tests.
os.environ["CODECITY_QUIET"] = "1"

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURE = FIXTURES_DIR / "sample-repo"


def _ensure_fixture() -> None:
    """Make sure fixtures/setup.sh has been run."""
    if not (FIXTURE / ".git").is_dir():
        subprocess.check_call(["bash", str(FIXTURES_DIR / "setup.sh")])


class ExtensionTests(unittest.TestCase):
    def test_plain_file(self):
        self.assertEqual(_extension("index.ts"), ".ts")

    def test_multiple_dots(self):
        self.assertEqual(_extension("index.test.ts"), ".ts")

    def test_dotfile_without_second_dot(self):
        # .gitignore has no extension in the scanner's view.
        self.assertEqual(_extension(".gitignore"), "")
        self.assertEqual(_extension(".env"), "")

    def test_dotfile_with_second_dot(self):
        self.assertEqual(_extension(".env.local"), ".local")

    def test_no_dot_at_all(self):
        self.assertEqual(_extension("Makefile"), "")


class BinaryDetectionTests(unittest.TestCase):
    def _tmp_file(self, content: bytes) -> Path:
        fd, name = tempfile.mkstemp()
        os.close(fd)
        p = Path(name)
        p.write_bytes(content)
        self.addCleanup(p.unlink, missing_ok=True)
        return p

    def test_text_file_is_text(self):
        p = self._tmp_file(b"hello world\nline two\n")
        self.assertFalse(_is_binary(p))

    def test_file_with_null_bytes_is_binary(self):
        p = self._tmp_file(b"hello\x00world")
        self.assertTrue(_is_binary(p))

    def test_empty_file_is_text(self):
        p = self._tmp_file(b"")
        self.assertFalse(_is_binary(p))

    def test_mostly_control_chars_is_binary(self):
        # 200 random control bytes (outside the _TEXT_CHARACTERS set)
        p = self._tmp_file(bytes(range(1, 7)) * 40)
        self.assertTrue(_is_binary(p))


class ScanTreeIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_manifest_top_level_shape(self):
        m = scan_tree(str(FIXTURE))
        self.assertIn("root", m)
        self.assertIn("scanned_at", m)
        self.assertIn("tree", m)
        self.assertEqual(m["tree"]["type"], "directory")
        self.assertEqual(m["tree"]["path"], ".")
        self.assertEqual(m["tree"]["name"], "sample-repo")

    def test_counts_roll_up_correctly(self):
        m = scan_tree(str(FIXTURE))
        tree = m["tree"]
        self.assertEqual(tree["descendants_file_count"], 9)
        self.assertEqual(tree["descendants_dir_count"], 4)
        self.assertEqual(tree["descendants_count"], 13)
        self.assertGreater(tree["descendants_size"], 0)

    def test_signature_present_and_stable(self):
        m1 = scan_tree(str(FIXTURE))
        m2 = scan_tree(str(FIXTURE))
        self.assertIn("signature", m1)
        self.assertIsInstance(m1["signature"], str)
        self.assertEqual(m1["signature"], m2["signature"])

    def test_git_dates_present_on_tracked_file(self):
        m = scan_tree(str(FIXTURE))
        for node in _walk_files(m["tree"]):
            if node["name"] == "index.ts":
                self.assertIsNotNone(node["git"])
                self.assertEqual(node["git"]["created"], "2024-03-22T14:30:00Z")
                self.assertEqual(node["git"]["modified"], "2024-03-22T14:30:00Z")
                return
        self.fail("index.ts not found in manifest")

    def test_git_dir_is_excluded(self):
        m = scan_tree(str(FIXTURE))
        names = [n["name"] for n in _walk_dirs(m["tree"])]
        self.assertNotIn(".git", names)

    def test_binary_flag_on_png(self):
        m = scan_tree(str(FIXTURE))
        for node in _walk_files(m["tree"]):
            if node["name"] == "logo.png":
                self.assertTrue(node["binary"])
                return
        self.fail("logo.png not found in manifest")

    def test_untracked_files_excluded_from_git_repo(self):
        # In a git repo we always honor the tracked set — uncommitted files
        # don't appear in the manifest.
        untracked = FIXTURE / "untracked-temp.txt"
        untracked.write_text("not tracked")
        try:
            m = scan_tree(str(FIXTURE))
            names = [n["name"] for n in _walk_files(m["tree"])]
            self.assertNotIn("untracked-temp.txt", names)
        finally:
            untracked.unlink(missing_ok=True)


    def test_include_all_returns_untracked_files(self):
        # Default scan: untracked file is hidden (existing behavior).
        # include_all=True: untracked file appears in the tree.
        untracked = FIXTURE / "untracked-include-all.txt"
        untracked.write_text("hello include_all")
        try:
            m_default = scan_tree(str(FIXTURE))
            names_default = [n["name"] for n in _walk_files(m_default["tree"])]
            self.assertNotIn("untracked-include-all.txt", names_default)

            m_all = scan_tree(str(FIXTURE), include_all=True)
            names_all = [n["name"] for n in _walk_files(m_all["tree"])]
            self.assertIn("untracked-include-all.txt", names_all)

            # Untracked file has no git history.
            for node in _walk_files(m_all["tree"]):
                if node["name"] == "untracked-include-all.txt":
                    self.assertIsNotNone(node["git"])
                    self.assertIsNone(node["git"]["created"])
                    self.assertIsNone(node["git"]["modified"])
                    return
            self.fail("untracked-include-all.txt not found in include_all manifest")
        finally:
            untracked.unlink(missing_ok=True)

    def test_include_all_returns_gitignored_files(self):
        # Default scan: gitignored file is hidden (existing behavior).
        # include_all=True: gitignored file appears in the tree.
        # The fixture's .gitignore must list the path for git ls-files
        # to drop it; we restore it after.
        gitignore_path = FIXTURE / ".gitignore"
        original_gitignore = gitignore_path.read_text() if gitignore_path.exists() else ""
        ignored_file = FIXTURE / "ignored-include-all.txt"
        ignored_file.write_text("hidden by .gitignore")
        try:
            gitignore_path.write_text(
                original_gitignore + "\nignored-include-all.txt\n"
            )

            m_default = scan_tree(str(FIXTURE))
            names_default = [n["name"] for n in _walk_files(m_default["tree"])]
            self.assertNotIn("ignored-include-all.txt", names_default)

            m_all = scan_tree(str(FIXTURE), include_all=True)
            names_all = [n["name"] for n in _walk_files(m_all["tree"])]
            self.assertIn("ignored-include-all.txt", names_all)
        finally:
            ignored_file.unlink(missing_ok=True)
            if original_gitignore:
                gitignore_path.write_text(original_gitignore)
            else:
                gitignore_path.unlink(missing_ok=True)

    def test_include_all_no_op_outside_git_repo(self):
        # In a non-git directory, the tracked-files filter never engages,
        # so include_all should be a no-op (signature + tree shape match).
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "a.txt").write_text("a")
            (Path(tmp) / "b.txt").write_text("b")
            m_default = scan_tree(tmp)
            m_all = scan_tree(tmp, include_all=True)
            self.assertEqual(m_default["signature"], m_all["signature"])
            self.assertEqual(
                m_default["tree"]["descendants_file_count"],
                m_all["tree"]["descendants_file_count"],
            )

    def test_git_dir_still_excluded_with_include_all(self):
        # .git/ is excluded independent of the tracked-files filter.
        m = scan_tree(str(FIXTURE), include_all=True)
        names = [n["name"] for n in _walk_dirs(m["tree"])]
        self.assertNotIn(".git", names)

    def test_skip_list_excludes_node_modules_under_include_all(self):
        # node_modules/ should NOT appear with include_all=True (default
        # respect_skip_list=True). It IS present on disk in the fixture
        # for this test only.
        nm_dir = FIXTURE / "node_modules" / "fake-pkg"
        nm_dir.mkdir(parents=True, exist_ok=True)
        nm_file = nm_dir / "index.js"
        nm_file.write_text("module.exports = {};")
        try:
            m_skipped = scan_tree(str(FIXTURE), include_all=True)
            names = [n["name"] for n in _walk_dirs(m_skipped["tree"])]
            self.assertNotIn("node_modules", names)

            m_unskipped = scan_tree(
                str(FIXTURE), include_all=True, respect_skip_list=False,
            )
            names_un = [n["name"] for n in _walk_dirs(m_unskipped["tree"])]
            self.assertIn("node_modules", names_un)
        finally:
            nm_file.unlink(missing_ok=True)
            nm_dir.rmdir()
            (FIXTURE / "node_modules").rmdir()

    def test_skip_list_does_not_affect_default_scan(self):
        # In a default tracked-only scan, the skip list is moot because
        # node_modules/ wouldn't be in git ls-files anyway. Confirm
        # passing respect_skip_list=False doesn't change anything.
        m_default = scan_tree(str(FIXTURE))
        m_no_skip = scan_tree(str(FIXTURE), respect_skip_list=False)
        self.assertEqual(m_default["signature"], m_no_skip["signature"])

    def test_git_dir_excluded_even_with_no_skip_list(self):
        # .git/ is special: always excluded, even when respect_skip_list=False.
        m = scan_tree(str(FIXTURE), include_all=True, respect_skip_list=False)
        names = [n["name"] for n in _walk_dirs(m["tree"])]
        self.assertNotIn(".git", names)


class SignatureTreeTests(unittest.TestCase):
    """signature_tree() must produce the same digest as scan_tree() does
    for the same root — that's the contract the live-update poll relies
    on. Drift here means every poll triggers a full reload."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_signature_matches_scan_tree(self):
        m = scan_tree(str(FIXTURE))
        s = signature_tree(str(FIXTURE))
        self.assertEqual(s["signature"], m["signature"])

    def test_signature_response_shape(self):
        s = signature_tree(str(FIXTURE))
        self.assertIn("root", s)
        self.assertIn("scanned_at", s)
        self.assertIn("signature", s)
        self.assertIsInstance(s["signature"], str)
        # No tree / repo fields — that's the whole point.
        self.assertNotIn("tree", s)
        self.assertNotIn("repo", s)

    def test_signature_changes_when_tracked_file_changes(self):
        # Add a tracked file, signature must shift; remove it, restored.
        before = signature_tree(str(FIXTURE))["signature"]
        new_file = FIXTURE / "sig-test-temp.txt"
        new_file.write_text("hello")
        try:
            subprocess.check_call(["git", "-C", str(FIXTURE), "add", str(new_file.name)])
            after_add = signature_tree(str(FIXTURE))["signature"]
            self.assertNotEqual(before, after_add)
        finally:
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "HEAD", new_file.name],
                check=False,
                capture_output=True,
            )
            new_file.unlink(missing_ok=True)

    def test_include_all_signature_matches_full_scan(self):
        # Parity contract still holds in include_all mode.
        m = scan_tree(str(FIXTURE), include_all=True)
        s = signature_tree(str(FIXTURE), include_all=True)
        self.assertEqual(s["signature"], m["signature"])

    def test_include_all_signature_differs_from_default(self):
        # Adding files that only show up under include_all must change
        # the signature relative to the default scan, otherwise the
        # frontend would never re-render after the toggle flips.
        untracked = FIXTURE / "sig-temp-include-all.txt"
        untracked.write_text("payload")
        try:
            default_sig = signature_tree(str(FIXTURE))["signature"]
            all_sig = signature_tree(str(FIXTURE), include_all=True)["signature"]
            self.assertNotEqual(default_sig, all_sig)
        finally:
            untracked.unlink(missing_ok=True)

    def test_signature_honors_respect_skip_list(self):
        # Parity contract: signature_tree must agree with scan_tree on
        # both respect_skip_list values.
        nm_dir = FIXTURE / "node_modules" / "fake-pkg"
        nm_dir.mkdir(parents=True, exist_ok=True)
        nm_file = nm_dir / "index.js"
        nm_file.write_text("module.exports = {};")
        try:
            m1 = scan_tree(str(FIXTURE), include_all=True, respect_skip_list=True)
            s1 = signature_tree(str(FIXTURE), include_all=True, respect_skip_list=True)
            self.assertEqual(s1["signature"], m1["signature"])

            m2 = scan_tree(str(FIXTURE), include_all=True, respect_skip_list=False)
            s2 = signature_tree(str(FIXTURE), include_all=True, respect_skip_list=False)
            self.assertEqual(s2["signature"], m2["signature"])

            # And the two modes must produce different signatures (otherwise
            # the toggle wouldn't trigger a reload).
            self.assertNotEqual(s1["signature"], s2["signature"])
        finally:
            nm_file.unlink(missing_ok=True)
            nm_dir.rmdir()
            (FIXTURE / "node_modules").rmdir()


def _walk_files(node):
    """Yield every file node in the tree."""
    if node.get("type") == "file":
        yield node
    for c in node.get("children", []):
        yield from _walk_files(c)


def _walk_dirs(node):
    """Yield every directory node (including root)."""
    if node.get("type") == "directory":
        yield node
    for c in node.get("children", []):
        yield from _walk_dirs(c)


if __name__ == "__main__":
    unittest.main()
