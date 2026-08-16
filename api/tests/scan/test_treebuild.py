"""The shared tree builder: the injected-callable seam, rollups, and the
per-directory extension breakdown."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from api.git.meta import collect_git_history, collect_git_state
from api.scan.scanner import LiveTreeSource
from api.scan.signatures import derive_tree_signals, new_signature
from api.scan.skiprules import SkipRules
from api.scan.treebuild import apply_git_dates
from api.tests.conftest import (
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
)


def test_build_tree_callable_seam_matches_live_scan(tmp_path):
    """build_tree, driven by the same LiveTreeSource scan_tree uses, reproduces
    a live scan's tree exactly (structure, paths, names, fullPaths, sizes,
    dates, ext-breakdown). lines/binary are filled in by
    populate_file_metadata after the build, so they're normalized away here.
    This locks the injected-callable seam to live behavior."""
    init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("one\ntwo\nthree\n")
    (tmp_path / "z.md").write_text("# doc\n")
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "b.py").write_text("x = 1\ny = 2\n")
    (tmp_path / "pkg" / "sub").mkdir()
    (tmp_path / "pkg" / "sub" / "c.py").write_text("z = 3\n")
    commit_all(tmp_path, "c1")

    root_abs = str(tmp_path.resolve())
    live = _final_manifest(root_abs, use_cache=False).tree

    # Drive the shared builder through the exact seam scan_tree uses, proving
    # the loop is a pure function of that seam.
    root_path = Path(root_abs)
    git = collect_git_state(root_path)
    history = collect_git_history(root_path, use_cache=False)
    built = LiveTreeSource(
        root_abs, git, SkipRules.load(root_path), new_signature()
    ).build()
    # The walk records fs dates; the live scan overlays history after emitting
    # its skeleton, so the seam has to do the same to line up.
    apply_git_dates(built, history.created, history.modified)

    def normalize(node):
        """Compare as dicts, with the fields populate_file_metadata fills in
        later flattened away — the two build paths must agree on structure, not
        on metadata that hasn't been read yet."""
        n = node.model_dump()
        if n["type"] == "file":
            n["lines"] = 0
            n["binary"] = False
            n.pop("media_width", None)
            n.pop("media_height", None)
        else:
            n["children"] = [normalize(c) for c in node.children]
        return n

    built_norm = normalize(built)
    live_norm = normalize(live)
    # _wrap_manifest overwrites the root name with the git-remote label; the
    # raw builder uses the root basename. Everything below the root matches.
    live_norm["name"] = built_norm["name"]
    assert built_norm == live_norm
    # Signatures are derived purely from the built tree, so they must match.
    assert (
        derive_tree_signals(built).layout_signature
        == derive_tree_signals(live).layout_signature
    )


class ExtBreakdownTests(CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_counts_roll_up_correctly(self):
        m = _final_manifest(str(FIXTURE))
        tree = m.tree
        # +1 for CONTRIBUTORS.md (second-author commit) and +1 for
        # MULTIAUTHOR.md (multi-author/co-authored commit).
        self.assertEqual(tree.descendants_file_count, 11)
        self.assertEqual(tree.descendants_dir_count, 4)
        # descendants_count = files + dirs.
        self.assertEqual(tree.descendants_count, 15)
        self.assertGreater(tree.descendants_size, 0)

    def test_ext_breakdown_rolls_up(self):
        m = _final_manifest(str(FIXTURE))
        tree = m.tree
        breakdown = tree.descendants_ext_breakdown
        for entry in breakdown:
            self.assertEqual(set(type(entry).model_fields), {"ext", "count", "size"})
        # Per-ext counts/sizes partition the descendant files exactly.
        self.assertEqual(sum(e.count for e in breakdown), tree.descendants_file_count)
        self.assertEqual(sum(e.size for e in breakdown), tree.descendants_size)
        # Sorted by count descending.
        counts = [e.count for e in breakdown]
        self.assertEqual(counts, sorted(counts, reverse=True))
        # Extension keys are lowercase, dot-prefixed; the fixture has .md files.
        self.assertIn(".md", {e.ext for e in breakdown})

    def test_ext_breakdown_leaf_dir_only_counts_own_files(self):
        # A nested directory's breakdown must cover only its own subtree,
        # not the whole repo.
        m = _final_manifest(str(FIXTURE))

        def _find_dir_with_files(node):
            if node.type != "directory":
                return None
            if node.children_file_count > 0 and node.path != ".":
                return node
            for child in node.children:
                found = _find_dir_with_files(child)
                if found:
                    return found
            return None

        sub = _find_dir_with_files(m.tree)
        if sub is not None:
            self.assertEqual(
                sum(e.count for e in sub.descendants_ext_breakdown),
                sub.descendants_file_count,
            )

    def test_ext_breakdown_extensionless_files_use_null(self):
        # Null `ext`, not a "(none)" sentinel, so the UI branches on null
        # rather than a magic string.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "LICENSE").write_text("mit")
            (root / "main.py").write_text("print()")
            commit_all(root)

            m = _final_manifest(str(root))
            breakdown = m.tree.descendants_ext_breakdown
            exts = {e.ext for e in breakdown}
            self.assertIn(None, exts)
            self.assertNotIn("(none)", exts)
            self.assertIn(".py", exts)
