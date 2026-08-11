"""The skip filter: ALWAYS_SKIP, .codecityignore, UI excludes, and the
tracked-files gate, both directly and end-to-end through a scan."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from api.scan.scanner import signature_tree
from api.scan.skiprules import SkipRules, tracked_entries
from api.tests.conftest import (
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
    walk_dirs,
    walk_files,
)


def test_tracked_entries_filters_and_orders(tmp_path):
    (tmp_path / "b.py").write_text("")
    (tmp_path / "a.py").write_text("")
    (tmp_path / "skip.py").write_text("")
    out = tracked_entries(
        str(tmp_path), ".", tracked={"a.py", "b.py"}, rules=SkipRules()
    )
    assert [rel for _e, rel in out] == [
        "a.py",
        "b.py",
    ]  # sorted, skip.py filtered (untracked)


class ExtraExcludePathsTests(CacheRedirectMixin, unittest.TestCase):
    def test_excludes_directory_and_subtree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "keep.txt").write_text("k")
            vendored = root / "vendor" / "big"
            vendored.mkdir(parents=True)
            (vendored / "lib.js").write_text("x\n" * 100)
            commit_all(root)
            m = _final_manifest(str(root), extra_exclude_paths=frozenset({"vendor"}))
            paths = [n["path"] for n in walk_dirs(m["tree"])]
            self.assertNotIn("vendor", paths)
            self.assertNotIn("vendor/big", paths)

    def test_excludes_root_level_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "keep.txt").write_text("k")
            (root / "drop.md").write_text("d")
            commit_all(root)
            m = _final_manifest(str(root), extra_exclude_paths=frozenset({"drop.md"}))
            names = [c["name"] for c in m["tree"]["children"]]
            self.assertIn("keep.txt", names)
            self.assertNotIn("drop.md", names)

    def test_rollups_reflect_smaller_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "a.txt").write_text("a")
            sub = root / "sub"
            sub.mkdir()
            (sub / "b.txt").write_text("b")
            commit_all(root)
            full = _final_manifest(str(root))
            filtered = _final_manifest(
                str(root), extra_exclude_paths=frozenset({"sub"})
            )
            self.assertLess(
                filtered["tree"]["descendants_file_count"],
                full["tree"]["descendants_file_count"],
            )

    def test_signature_differs_and_is_stable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "a.txt").write_text("a")
            sub = root / "sub"
            sub.mkdir()
            (sub / "b.txt").write_text("b")
            commit_all(root)
            base = signature_tree(str(root))["content_signature"]
            ex1 = signature_tree(str(root), extra_exclude_paths=frozenset({"sub"}))[
                "content_signature"
            ]
            ex2 = signature_tree(str(root), extra_exclude_paths=frozenset({"sub"}))[
                "content_signature"
            ]
            self.assertNotEqual(base, ex1)
            self.assertEqual(ex1, ex2)

    def test_cannot_override_always_skip(self):
        # An extra-exclude is additive: it can't un-hide .git or a lockfile.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "a.txt").write_text("a")
            commit_all(root)
            # Excluding a normal file still works; .git stays gone regardless.
            m = _final_manifest(str(root), extra_exclude_paths=frozenset({"a.txt"}))
            names = [c["name"] for c in m["tree"]["children"]]
            self.assertNotIn(".git", names)
            self.assertNotIn("a.txt", names)


class SkipRulesScanTests(CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_git_dir_is_excluded(self):
        m = _final_manifest(str(FIXTURE))
        names = [n["name"] for n in walk_dirs(m["tree"])]
        self.assertNotIn(".git", names)

    def test_untracked_files_excluded_from_git_repo(self):
        # In a git repo we always honor the tracked set — uncommitted files
        # don't appear in the manifest.
        untracked = FIXTURE / "untracked-temp.txt"
        untracked.write_text("not tracked")
        try:
            m = _final_manifest(str(FIXTURE))
            names = [n["name"] for n in walk_files(m["tree"])]
            self.assertNotIn("untracked-temp.txt", names)
        finally:
            untracked.unlink(missing_ok=True)

    def test_codecityignore_name_excludes_directory(self):
        # A bare name in .codecityignore matches any dir/file with that
        # name anywhere in the tree.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "keep.txt").write_text("k")
            target_dir = root / "noisy-fixture"
            target_dir.mkdir()
            (target_dir / "data.txt").write_text("noise")
            commit_all(root)
            (root / ".codecityignore").write_text("# project-specific\nnoisy-fixture\n")
            m = _final_manifest(str(root))
            names = [n["name"] for n in walk_dirs(m["tree"])]
            self.assertNotIn("noisy-fixture", names)

    def test_codecityignore_path_excludes_specific_path_only(self):
        # A line containing '/' is anchored to the scan root. A dir at
        # a different relative path with the same final segment is NOT
        # excluded.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            target_a = root / "stash" / "legacy"
            target_b = root / "legacy"  # same name, different path
            target_a.mkdir(parents=True)
            target_b.mkdir()
            (target_a / "x.txt").write_text("a")
            (target_b / "x.txt").write_text("b")
            commit_all(root)
            (root / ".codecityignore").write_text("stash/legacy\n")
            m = _final_manifest(str(root))
            paths = [n["path"] for n in walk_dirs(m["tree"])]
            self.assertNotIn("stash/legacy", paths)
            # The other "legacy" at a different path stays visible.
            self.assertIn("legacy", paths)

    def test_codecityignore_missing_is_ok(self):
        # No file -> no error, scan proceeds normally.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "a.txt").write_text("a")
            commit_all(root)
            self.assertFalse((root / ".codecityignore").exists())  # sanity
            m = _final_manifest(str(root))
            self.assertGreater(m["tree"]["descendants_file_count"], 0)

    def test_codecityignore_comments_and_blanks(self):
        # Comments and blank lines are silently dropped.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            target = root / "noisy-comment-test"
            target.mkdir()
            (target / "x.txt").write_text("x")
            commit_all(root)
            (root / ".codecityignore").write_text(
                "# leading comment\n"
                "\n"
                "noisy-comment-test\n"
                "   \n"  # blank-with-whitespace
                "# trailing comment\n"
            )
            m = _final_manifest(str(root))
            names = [n["name"] for n in walk_dirs(m["tree"])]
            self.assertNotIn("noisy-comment-test", names)

    def test_codecityignore_negation_unignores_always_skip(self):
        # `!node_modules` overrides ALWAYS_SKIP, so the dir surfaces.
        # node_modules is normally gitignored; here we force it into the
        # repo so the ALWAYS_SKIP rule is the only thing hiding it.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            nm_dir = root / "node_modules" / "fake-pkg"
            nm_dir.mkdir(parents=True)
            (nm_dir / "index.js").write_text("module.exports = {};")
            commit_all(root)
            (root / ".codecityignore").write_text("!node_modules\n")
            m = _final_manifest(str(root))
            names = [n["name"] for n in walk_dirs(m["tree"])]
            self.assertIn("node_modules", names)

    def test_sbom_json_is_always_skipped(self):
        # sbom.json is a generated artifact (CycloneDX/SPDX), not authored code.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "app.py").write_text("print('hi')\n")
            (root / "sbom.json").write_text('{"bomFormat": "CycloneDX"}\n')
            commit_all(root)
            m = _final_manifest(str(root))
            names = [n["name"] for n in walk_files(m["tree"])]
            self.assertIn("app.py", names)
            self.assertNotIn("sbom.json", names)

    def test_codecityignore_negation_path_anchored(self):
        # `!stash/legacy` un-ignores only that exact path. Another dir
        # named `legacy` at a different rel-path stays excluded by the
        # bare `legacy` rule.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            target_a = root / "stash" / "legacy"
            target_b = root / "elsewhere" / "legacy"
            target_a.mkdir(parents=True)
            target_b.mkdir(parents=True)
            (target_a / "x.txt").write_text("a")
            (target_b / "x.txt").write_text("b")
            commit_all(root)
            # Ignore both names at the bare level, then un-ignore one path.
            (root / ".codecityignore").write_text("legacy\n!stash/legacy\n")
            m = _final_manifest(str(root))
            paths = [n["path"] for n in walk_dirs(m["tree"])]
            self.assertIn("stash/legacy", paths)
            self.assertNotIn("elsewhere/legacy", paths)

    def test_codecityignore_negation_does_not_unignore_git_dir(self):
        # `!.git` is silently ignored — walking the object database is
        # always disallowed regardless of user config. _init_repo gives
        # us a real .git/ directory; the hardcoded `name == ".git"`
        # check should drop it even with the negation in place.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "keep.txt").write_text("k")
            commit_all(root)
            (root / ".codecityignore").write_text("!.git\n")
            m = _final_manifest(str(root))
            names = [n["name"] for n in walk_dirs(m["tree"])]
            self.assertNotIn(".git", names)
