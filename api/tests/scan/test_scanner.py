"""The scanner entry points end to end: the streamed emit sequence, cancellation,
and time-travel reconstruction."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api.manifest_types import Manifest
from api.scan.scanner import reconstruct_manifest, scan_tree
from api.tests.conftest import (
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
    walk_files,
)


class ScanTreeStreamingTests(unittest.TestCase):
    def _make_tiny_repo(self, tmpdir: str) -> str:
        # Two files in a fresh git repo. scan_tree requires git.
        root = Path(tmpdir)
        init_repo(root)
        (root / "a.py").write_text("x = 1\ny = 2\n")
        (root / "b.py").write_text("z = 3\n")
        commit_all(root)
        return tmpdir

    def test_yields_skeleton_then_final(self) -> None:
        from api.scan.scanner import scan_tree

        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            events = list(scan_tree(td))
        self.assertEqual(len(events), 3)
        self.assertEqual(events[0]["phase"], "manifest-partial")
        self.assertEqual(events[1]["phase"], "manifest-partial")
        self.assertEqual(events[2]["phase"], "manifest-complete")
        # Each emit declares what is still provisional.
        self.assertEqual(events[0]["manifest"]["pending"], ["metadata", "history"])
        self.assertEqual(events[1]["manifest"]["pending"], ["history"])
        self.assertEqual(events[2]["manifest"]["pending"], [])

    def test_skeleton_has_placeholder_metadata(self) -> None:
        from api.scan.scanner import scan_tree

        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            skeleton, _metadata, _final = list(scan_tree(td))

        # Walk the tree and assert every file has placeholder lines/binary.
        def files(node):
            for child in node["children"]:
                if child["type"] == "file":
                    yield child
                else:
                    yield from files(child)

        for f in files(skeleton["manifest"]["tree"]):
            self.assertEqual(
                f["lines"], 1, f"{f['path']} should have placeholder lines=1"
            )
            self.assertFalse(
                f["binary"], f"{f['path']} should have placeholder binary=False"
            )

    def test_cancel_event_pre_set_raises_at_first_boundary(self) -> None:
        import threading
        from api.scan.scanner import scan_tree
        from api.errors import ScanCancelledError

        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            ev = threading.Event()
            ev.set()
            gen = scan_tree(td, cancel_event=ev)
            with self.assertRaises(ScanCancelledError):
                list(gen)

    def test_cancel_event_set_after_skeleton_raises_in_populate(self) -> None:
        import threading
        from api.scan.scanner import scan_tree
        from api.errors import ScanCancelledError

        with TemporaryDirectory() as td:
            root = Path(td)
            init_repo(root)
            # Make enough files that the pool has work to do AFTER the
            # skeleton emits, so the event-set-after-skeleton case
            # genuinely interrupts metadata population.
            for i in range(20):
                (root / f"f{i}.py").write_text("x = 1\n" * 50)
            commit_all(root)
            ev = threading.Event()
            gen = scan_tree(td, cancel_event=ev)
            skeleton = next(gen)
            self.assertEqual(skeleton["phase"], "manifest-partial")
            ev.set()
            with self.assertRaises(ScanCancelledError):
                next(gen)


def _tree_file_paths(manifest: Manifest) -> set[str]:
    paths: set[str] = set()

    def walk(n):
        if n["type"] == "file":
            paths.add(n["path"])
        else:
            for c in n["children"]:
                walk(c)

    walk(manifest["tree"])
    return paths


def _tree_file_stats(manifest: Manifest) -> dict[str, tuple[int, int, bool]]:
    """{path -> (size, lines, binary)} for every file node — the fields the
    reconstruction guard compares against a live scan (content_signature is
    NOT compared: it hashes real fs mtime, which a ref reconstruction lacks)."""
    stats: dict[str, tuple[int, int, bool]] = {}

    def walk(n):
        if n["type"] == "file":
            stats[n["path"]] = (n["size"], n["lines"], n["binary"])
        else:
            for c in n["children"]:
                walk(c)

    walk(manifest["tree"])
    return stats


def test_reconstruct_at_old_ref_shrinks_city(tmp_path):
    from api.git.meta import run_git

    init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("1\n")
    commit_all(tmp_path, "c1")
    old = run_git(tmp_path, "rev-parse", "HEAD").strip()
    (tmp_path / "b.txt").write_text("2\n")
    commit_all(tmp_path, "c2")

    m_old = reconstruct_manifest(str(tmp_path), old, use_cache=False)
    assert _tree_file_paths(m_old) == {"a.txt"}  # b.txt didn't exist yet
    assert m_old["repo"]["dirty"] is False
    assert len(m_old["commits"]) == 1


def test_reconstruct_bad_ref_raises(tmp_path):

    init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("1\n")
    commit_all(tmp_path, "c1")
    with pytest.raises(ValueError):
        reconstruct_manifest(str(tmp_path), "--upload-pack=x", use_cache=False)


def test_reconstruct_head_matches_live_scan(tmp_path):
    """Reconstructing HEAD must reproduce a live scan's structure + layout
    signatures and per-file (size, lines, binary). This is the Task-4 guard:
    reconstruction and the live walk share _build_tree, so any divergence in
    ordering/structure surfaces here. content_signature is intentionally NOT
    compared (it hashes fs mtime, absent in a ref reconstruction)."""

    init_repo(tmp_path)
    (tmp_path / "README.md").write_text("# title\nsecond line\n")
    (tmp_path / "config.json").write_text('{"a": 1}\n')
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('hi')\nprint('bye')\n")
    (tmp_path / "src" / "util.py").write_text("x = 1\n")
    (tmp_path / "src" / "lib").mkdir()
    (tmp_path / "src" / "lib" / "helper.ts").write_text("export const a = 1\n")
    (tmp_path / "src" / "lib" / "types.ts").write_text("export type T = number\n")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "guide.md").write_text("a\nb\nc\n")
    # A committed symlink must vanish from BOTH the live scan and the
    # reconstruction (gitobj.ls_tree_files skips mode-120000 entries to match
    # the live scan's follow_symlinks=False gate) — otherwise this guard
    # would miss a divergence where reconstruction alone kept it.
    os.symlink("README.md", tmp_path / "link.md")
    commit_all(tmp_path, "c1")

    live = _final_manifest(str(tmp_path), use_cache=False)
    recon = reconstruct_manifest(str(tmp_path), "HEAD", use_cache=False)

    live_paths = {n["path"] for n in walk_files(live["tree"])}
    recon_paths = {n["path"] for n in walk_files(recon["tree"])}
    assert "link.md" not in live_paths
    assert "link.md" not in recon_paths

    assert recon["structure_signature"] == live["structure_signature"]
    assert recon["layout_signature"] == live["layout_signature"]
    assert _tree_file_stats(recon) == _tree_file_stats(live)


class ScanStreamContentTests(CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_date_ranges_present_on_every_emit(self):
        # Both SSE phases route through _wrap_manifest, so both must carry
        # dateRanges. The skeleton's are filesystem-derived: it is emitted
        # before the git history walk, so its tree still holds the fs dates the
        # scan recorded. The final's come from history.
        events = list(scan_tree(str(FIXTURE), use_cache=False))
        phases = [e["phase"] for e in events]
        self.assertIn("manifest-partial", phases)
        self.assertIn("manifest-complete", phases)
        ranges = [e["manifest"]["dateRanges"] for e in events]
        for r in ranges:
            self.assertEqual(
                set(r.keys()),
                {"minCreated", "maxCreated", "minModified", "maxModified"},
            )
        final = events[-1]["manifest"]
        created = [n["created"] for n in walk_files(final["tree"])]
        modified = [n["modified"] for n in walk_files(final["tree"])]
        self.assertEqual(ranges[-1]["minCreated"], min(created))
        self.assertEqual(ranges[-1]["maxModified"], max(modified))

    def test_skeleton_emits_before_the_history_walk(self):
        # The history walk is ~75% of a big cold load and nothing the skeleton
        # draws reads it, so the skeleton must not wait on it. Commits ride the
        # final manifest alone — they are ~89% of the payload.
        from unittest import mock

        from api.scan import scanner as scanmod

        walked: list[str] = []
        real_history = scanmod.collect_git_history

        def _spy(*args, **kwargs):
            walked.append("history")
            return real_history(*args, **kwargs)

        with mock.patch.object(scanmod, "collect_git_history", _spy):
            events = scan_tree(str(FIXTURE), use_cache=False)
            skeleton = next(events)
            self.assertEqual(skeleton["phase"], "manifest-partial")
            self.assertEqual(walked, [], "history walked before the skeleton")
            self.assertEqual(skeleton["manifest"]["commits"], [])
            final = list(events)[-1]

        self.assertEqual(walked, ["history"])
        self.assertEqual(final["phase"], "manifest-complete")
        self.assertGreater(len(final["manifest"]["commits"]), 0)
        # The packer runs on the skeleton and the frontend keeps that layout iff
        # this is unchanged, so deferring history must not disturb it.
        self.assertEqual(
            skeleton["manifest"]["layout_signature"],
            final["manifest"]["layout_signature"],
        )
        # Dates still resolve to history, not to the fs dates the walk recorded.
        self.assertEqual(
            [n["created"] for n in walk_files(final["manifest"]["tree"])],
            [n["created"] for n in walk_files(_final_manifest(str(FIXTURE))["tree"])],
        )

    def test_same_day_total_baked_on_every_commit(self):
        m = _final_manifest(str(FIXTURE))
        commits = m["commits"]
        self.assertGreater(len(commits), 0)
        # Recompute the per-day grouping independently and assert each
        # commit's baked same_day_total matches (>= 1, includes self).
        per_day: dict[str, int] = {}
        for c in commits:
            per_day[c["date"]] = per_day.get(c["date"], 0) + 1
        for c in commits:
            self.assertIn("same_day_total", c)
            self.assertEqual(c["same_day_total"], per_day[c["date"]])
            self.assertGreaterEqual(c["same_day_total"], 1)

    def test_same_day_total_present_on_every_emit(self):
        # same_day_total is NotRequired on the internal TypedDict (it's baked
        # in-place at wrap time) but REQUIRED on the wire. Both the skeleton
        # and final emits route through _wrap_manifest, so both must carry it
        # on every commit. Guards against a future emit path skipping wrap.
        events = list(scan_tree(str(FIXTURE), use_cache=False))
        phases = [e["phase"] for e in events]
        self.assertIn("manifest-partial", phases)
        self.assertIn("manifest-complete", phases)
        for e in events:
            for c in e["manifest"]["commits"]:
                self.assertIn(
                    "same_day_total", c, f"{e['phase']} commit missing same_day_total"
                )

    def test_scan_tree_emits_commits_list(self):
        m = _final_manifest(str(FIXTURE), use_cache=False)
        self.assertIn("commits", m)
        self.assertGreater(len(m["commits"]), 0)
        dates = [c["date"] for c in m["commits"]]
        self.assertEqual(dates, sorted(dates))

    def test_deep_history_ships_a_sample_with_exact_aggregates(self):
        full = _final_manifest(str(FIXTURE), use_cache=False)
        self.assertGreater(len(full["commits"]), 2)
        with mock.patch("api.scan.manifest.MAX_WIRE_COMMITS", 2):
            capped = _final_manifest(str(FIXTURE), use_cache=False)
        self.assertEqual(len(capped["commits"]), 2)
        # Both ends survive, and everything derived from the history still
        # reads the whole of it.
        self.assertEqual(capped["commits"][0], full["commits"][0])
        self.assertEqual(capped["commits"][-1], full["commits"][-1])
        self.assertEqual(capped["stats"]["commitCount"], len(full["commits"]))
        self.assertEqual(capped["stats"], full["stats"])
        self.assertEqual(capped["busyness"], full["busyness"])

    def test_scan_tree_rejects_non_git_root(self):
        """scan_tree must raise NotAGitRepoError on a non-git directory.
        Server enforces this at the HTTP boundary; the scanner check is
        defense-in-depth so direct callers fail fast."""
        from api.errors import NotAGitRepoError

        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.txt").write_text("hello")
            with self.assertRaises(NotAGitRepoError):
                _final_manifest(td, use_cache=False)
