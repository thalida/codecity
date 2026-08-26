"""The manifest envelope: commit sampling and the README resolution every
emit shares."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


import pytest

from api.scan.manifest import sample_commits
from api.tests.conftest import (
    make_commit,
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
    walk_files,
)


def _numbered_commits(n: int) -> list:
    return [make_commit(str(i), date="2026-01-01") for i in range(n)]


@pytest.mark.parametrize("total", [0, 1, 9, 10])
def test_sample_commits_leaves_short_histories_alone(total, monkeypatch):
    monkeypatch.setattr("api.scan.manifest.MAX_WIRE_COMMITS", 10)
    commits = _numbered_commits(total)
    assert sample_commits(commits) is commits


def test_sample_commits_strides_a_deep_history(monkeypatch):
    monkeypatch.setattr("api.scan.manifest.MAX_WIRE_COMMITS", 5)
    shas = [c.sha for c in sample_commits(_numbered_commits(100))]
    # Both ends kept, evenly spaced, chronological order preserved.
    assert shas == ["0", "25", "50", "74", "99"]


def test_sample_commits_keeps_both_ends_at_the_cap_boundary(monkeypatch):
    monkeypatch.setattr("api.scan.manifest.MAX_WIRE_COMMITS", 3)
    shas = [c.sha for c in sample_commits(_numbered_commits(4))]
    assert shas == ["0", "2", "3"]


class ManifestEnvelopeTests(CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_manifest_top_level_shape(self):
        m = _final_manifest(str(FIXTURE))
        for field in ("src", "branch", "scanned_at", "tree"):
            self.assertTrue(hasattr(m, field), field)
        self.assertEqual(m.tree.type, "directory")
        self.assertEqual(m.tree.path, ".")
        self.assertEqual(m.tree.name, "sample-repo")

    def test_tree_name_baked_from_git_remote(self):
        # The remote's owner/repo, not the on-disk basename — which would be a
        # worktree folder name or a clone's cache-dir hash.
        with TemporaryDirectory() as td:
            root = Path(td) / "some-worktree-folder"
            root.mkdir()
            init_repo(root)
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "remote",
                    "add",
                    "origin",
                    "https://github.com/owner/coolrepo.git",
                ],
                check=True,
            )
            (root / "a.txt").write_text("hi")
            commit_all(root)
            m = _final_manifest(str(root), use_cache=False)
            self.assertEqual(m.tree.name, "owner/coolrepo")

    def test_readme_path_resolves_root_readme_case_insensitively(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            init_repo(root)
            (root / "ReadMe.MD").write_text("# hi")
            (root / "main.py").write_text("print()")
            commit_all(root)

            m = _final_manifest(str(root))
            self.assertIsNotNone(m.readmePath)
            self.assertTrue(m.readmePath.endswith("ReadMe.MD"))
            # Paired with the file's mtime so the client can cache-bust the fetch.
            names = {c.name: c for c in m.tree.children}
            self.assertEqual(m.readmeModified, names["ReadMe.MD"].modified)

    def test_readme_path_is_none_without_one_and_ignores_nested(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            init_repo(root)
            (root / "readme_notes.py").write_text("x")  # stem is not "readme"
            (root / "docs").mkdir()
            (root / "docs" / "README.md").write_text("# nested")
            commit_all(root)

            self.assertIsNone(_final_manifest(str(root)).readmePath)

    def test_busyness_present_in_manifest(self):
        m = _final_manifest(str(FIXTURE))
        b = m.busyness
        self.assertEqual(set(type(b).model_fields), {"avg", "busy"})
        self.assertIsInstance(b.avg, int)
        self.assertIsInstance(b.busy, int)
        # Bands stay distinct: busy is always at least avg + 1.
        self.assertGreaterEqual(b.busy, b.avg + 1)

    def test_stats_present_in_manifest(self):
        m = _final_manifest(str(FIXTURE))
        assert hasattr(m, "stats")
        s = m.stats
        assert isinstance(s.mediaCount, int)
        assert isinstance(s.authors, list)
        assert isinstance(s.maxCommitStreakDays, int)

    def test_date_ranges_present_in_manifest(self):
        m = _final_manifest(str(FIXTURE))
        r = m.dateRanges
        self.assertEqual(
            set(type(r).model_fields),
            {"minCreated", "maxCreated", "minModified", "maxModified"},
        )
        # Cross-check: recompute the extremes independently from the
        # emitted tree's resolved per-file dates.
        created = [n.created for n in walk_files(m.tree)]
        modified = [n.modified for n in walk_files(m.tree)]
        self.assertGreater(len(created), 0)
        self.assertEqual(r.minCreated, min(created))
        self.assertEqual(r.maxCreated, max(created))
        self.assertEqual(r.minModified, min(modified))
        self.assertEqual(r.maxModified, max(modified))

    def test_descendant_date_range_matches_repo_ranges(self):
        m = _final_manifest(str(FIXTURE))
        tree = m.tree
        # The root dir's oldest-created / newest-modified span the whole repo, so
        # they match the independently-computed repo-wide dateRanges.
        self.assertIsNotNone(tree.descendants_created_min)
        self.assertIsNotNone(tree.descendants_modified_max)
        self.assertEqual(tree.descendants_created_min, m.dateRanges.minCreated)
        self.assertEqual(tree.descendants_modified_max, m.dateRanges.maxModified)
        # Every file's created <= its modified, so the min/max span is ordered.
        self.assertLessEqual(
            tree.descendants_created_min, tree.descendants_modified_max
        )

    def test_signature_present_and_stable(self):
        m1 = _final_manifest(str(FIXTURE))
        m2 = _final_manifest(str(FIXTURE))
        self.assertTrue(hasattr(m1, "content_signature"))
        self.assertEqual(m1.content_signature, m2.content_signature)
