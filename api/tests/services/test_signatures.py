"""The three fingerprints: content_signature (via signature_tree),
structure_signature, and layout_signature."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import pytest

from api.services.scan import signature_tree
from api.services.signatures import derive_tree_signals
from api.tests.conftest import (
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
)


def _date_tree(*files: tuple[str, str, str]) -> dict:
    """DirNode of (name, created, modified) files. `size` is required because
    _derive_tree_signals reads every FileNode field in one pass."""
    return {
        "type": "directory",
        "path": ".",
        "name": "root",
        "children": [
            {
                "type": "file",
                "path": name,
                "name": name,
                "created": created,
                "modified": modified,
                "size": 0,
            }
            for name, created, modified in files
        ],
    }


@pytest.mark.parametrize(
    ("files", "expected"),
    [
        ((), (None, None, None, None)),
        (
            (("a.py", "2024-01-10T09:00:00Z", "2024-03-22T14:30:00Z"),),
            (
                "2024-01-10T09:00:00Z",
                "2024-01-10T09:00:00Z",
                "2024-03-22T14:30:00Z",
                "2024-03-22T14:30:00Z",
            ),
        ),
        (
            (
                ("a.py", "2024-02-15T10:00:00Z", "2024-02-15T10:00:00Z"),
                ("b.py", "2024-01-10T09:00:00Z", "2024-03-22T14:30:00Z"),
                ("c.py", "2024-01-20T12:00:00Z", "2024-01-20T12:00:00Z"),
            ),
            (
                "2024-01-10T09:00:00Z",
                "2024-02-15T10:00:00Z",
                "2024-01-20T12:00:00Z",
                "2024-03-22T14:30:00Z",
            ),
        ),
    ],
)
def test_derive_tree_signals_date_ranges(files, expected):
    min_c, max_c, min_m, max_m = expected
    assert derive_tree_signals(_date_tree(*files)).date_ranges == {
        "minCreated": min_c,
        "maxCreated": max_c,
        "minModified": min_m,
        "maxModified": max_m,
    }


class SignatureTreeTests(CacheRedirectMixin, unittest.TestCase):
    """signature_tree() must produce the same digest as scan_tree() does
    for the same root — that's the contract the live-update poll relies
    on. Drift here means every poll triggers a full reload."""

    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_signature_matches_scan_tree(self):
        m = _final_manifest(str(FIXTURE))
        s = signature_tree(str(FIXTURE))
        self.assertEqual(s["content_signature"], m["content_signature"])

    def test_signature_matches_scan_tree_on_dirty_repo(self):
        # The per-file dirty bit is computed at different call sites in the
        # two walks (_file_node's dirty_paths lookup vs _walk_for_signature's
        # inline `entry_rel in dirty_paths`) — a dirty repo is where
        # cross-walk drift in that bit would land undetected by the
        # clean-repo parity test above.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            tracked = root / "tracked.py"
            tracked.write_text("x = 1\n")
            commit_all(root)
            tracked.write_text("x = 2\n")  # edit after commit: repo is dirty

            m = _final_manifest(str(root))
            s = signature_tree(str(root))
            self.assertEqual(s["content_signature"], m["content_signature"])

    def test_signature_response_shape(self):
        s = signature_tree(str(FIXTURE))
        self.assertIn("root", s)
        self.assertIn("scanned_at", s)
        self.assertIn("content_signature", s)
        # No tree / repo fields — that's the whole point.
        self.assertNotIn("tree", s)
        self.assertNotIn("repo", s)

    def test_signature_changes_when_tracked_file_changes(self):
        # Add a tracked file, signature must shift; remove it, restored.
        before = signature_tree(str(FIXTURE))["content_signature"]
        new_file = FIXTURE / "sig-test-temp.txt"
        new_file.write_text("hello")
        try:
            subprocess.check_call(
                ["git", "-C", str(FIXTURE), "add", str(new_file.name)]
            )
            after_add = signature_tree(str(FIXTURE))["content_signature"]
            self.assertNotEqual(before, after_add)
        finally:
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "HEAD", new_file.name],
                check=False,
                capture_output=True,
            )
            new_file.unlink(missing_ok=True)

    def test_signature_honors_codecityignore(self):
        # Parity contract: editing .codecityignore must shift the
        # signature returned by signature_tree (so the live-update poll
        # actually triggers a reload), and that signature must match
        # scan_tree's output for the same root.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            target = root / "sig-noise-fixture"
            target.mkdir()
            (target / "x.txt").write_text("x")
            commit_all(root)
            ignore_file = root / ".codecityignore"

            # Without ignore file, target is visible.
            before_sig = signature_tree(str(root))["content_signature"]
            before_full = _final_manifest(str(root))["content_signature"]
            self.assertEqual(before_sig, before_full)

            # Add ignore entry, both signatures must shift in lockstep.
            ignore_file.write_text("sig-noise-fixture\n")
            after_sig = signature_tree(str(root))["content_signature"]
            after_full = _final_manifest(str(root))["content_signature"]
            self.assertEqual(after_sig, after_full)
            self.assertNotEqual(before_sig, after_sig)

    def test_signature_changes_with_dirty_path_set(self):
        # A per-file dirty transition that moves NO file's mtime/size and NO
        # head_sha (a mode-only edit) must still shift the signature, or a
        # cached manifest would serve a stale per-file dirty flag/count.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            a = root / "a.py"
            a.write_text("x = 1\n")
            b = root / "b.py"
            b.write_text("y = 2\n")
            commit_all(root)

            # Dirty b.py's content only — repo is dirty, dirty set is {b.py}.
            b.write_text("y = 2\nz = 3\n")
            before_stat = a.stat()
            sig_one_dirty = signature_tree(str(root))["content_signature"]

            # Now also flip a.py's executable bit: git sees it as modified
            # (added to the dirty set) but a.py's own mtime/size are
            # untouched, and head_sha/repo.dirty (already True) don't move.
            os.chmod(a, before_stat.st_mode | 0o111)
            after_stat = a.stat()
            self.assertEqual(before_stat.st_size, after_stat.st_size)
            self.assertEqual(before_stat.st_mtime, after_stat.st_mtime)

            sig_two_dirty = signature_tree(str(root))["content_signature"]
            self.assertNotEqual(sig_one_dirty, sig_two_dirty)


def _sig(tree: dict) -> str:
    """structure_signature of a minimal test tree, via _derive_tree_signals."""
    return derive_tree_signals(tree).structure_signature


class TreeSignatureTests(unittest.TestCase):
    """_derive_tree_signals' structure_signature is a stable, structure-only
    fingerprint.

    The signature must:
    1. Be identical for identical tree shapes regardless of file metadata.
    2. Change when a file or directory is added or renamed.
    3. Be deterministic across multiple calls for the same tree.
    4. Be present in BOTH skeleton and final manifest events for the same scan.
    """

    def _make_tree(self, entries: list[dict]) -> dict:
        """Build a minimal DirNode-like dict for testing."""
        return {
            "type": "directory",
            "path": ".",
            "name": "root",
            "children": entries,
        }

    def _make_file(
        self,
        path: str,
        size: int = 100,
        mtime: float = 1_000_000.0,
        created: str = "2024-01-01T00:00:00Z",
        modified: str = "2024-01-01T00:00:00Z",
    ) -> dict:
        """Build a minimal FileNode-like dict for testing."""
        return {
            "type": "file",
            "path": path,
            "name": path.rsplit("/", 1)[-1],
            "size": size,
            "mtime": mtime,
            "created": created,
            "modified": modified,
        }

    def test_same_shape_same_metadata_produces_same_signature(self):
        tree = self._make_tree([self._make_file("a.py"), self._make_file("b.py")])
        self.assertEqual(_sig(tree), _sig(tree))

    def test_same_shape_different_metadata_produces_same_signature(self):
        # Metadata (size, mtime) must NOT affect structure_signature.
        tree_a = self._make_tree([self._make_file("a.py", size=100, mtime=1.0)])
        tree_b = self._make_tree([self._make_file("a.py", size=999, mtime=9.9)])
        self.assertEqual(_sig(tree_a), _sig(tree_b))

    def test_adding_a_file_changes_signature(self):
        tree_before = self._make_tree([self._make_file("a.py")])
        tree_after = self._make_tree([self._make_file("a.py"), self._make_file("b.py")])
        self.assertNotEqual(_sig(tree_before), _sig(tree_after))

    def test_renaming_a_file_changes_signature(self):
        tree_before = self._make_tree([self._make_file("a.py")])
        tree_after = self._make_tree([self._make_file("z.py")])
        self.assertNotEqual(_sig(tree_before), _sig(tree_after))

    def test_adding_a_directory_changes_signature(self):
        tree_before = self._make_tree([self._make_file("a.py")])
        tree_after = self._make_tree(
            [
                self._make_file("a.py"),
                {
                    "type": "directory",
                    "path": "sub",
                    "name": "sub",
                    "children": [self._make_file("sub/b.py")],
                },
            ]
        )
        self.assertNotEqual(_sig(tree_before), _sig(tree_after))

    def test_deterministic_across_repeated_calls(self):
        tree = self._make_tree(
            [
                self._make_file("a.py"),
                self._make_file("b.py"),
                {
                    "type": "directory",
                    "path": "pkg",
                    "name": "pkg",
                    "children": [self._make_file("pkg/c.py")],
                },
            ]
        )
        results = {_sig(tree) for _ in range(5)}
        self.assertEqual(len(results), 1, "structure_signature must be deterministic")

    def test_returns_hex_string_of_expected_length(self):
        # blake2b digest_size=8 → 8 bytes → 16 hex chars.
        tree = self._make_tree([self._make_file("a.py")])
        sig = _sig(tree)
        self.assertEqual(len(sig), 16)
        int(sig, 16)  # must be valid hex — raises ValueError if not

    def test_skeleton_and_final_manifests_share_same_structure_signature(self):
        """The same structure_signature must appear in both the skeleton and final
        manifest events for the same scan — the whole point of this feature."""
        from api.services.scan import scan_tree

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            init_repo(root)
            (root / "hello.py").write_text("x = 1\n")
            (root / "world.py").write_text("y = 2\n")
            commit_all(root)
            events = list(scan_tree(td))
        self.assertEqual(len(events), 3)
        skeleton_sig = events[0]["manifest"]["structure_signature"]
        final_sig = events[-1]["manifest"]["structure_signature"]
        self.assertEqual(
            skeleton_sig,
            final_sig,
            "skeleton and final manifests must carry the same structure_signature",
        )

    def test_structure_signature_stable_when_only_metadata_changes(self):
        """structure_signature must be unchanged when only file content/lines/binary
        differs — i.e., between skeleton and final phases."""
        from api.services.scan import scan_tree

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            init_repo(root)
            (root / "a.py").write_text("x = 1\n" * 100)
            commit_all(root)
            events = list(scan_tree(td))
        skeleton = events[0]["manifest"]
        final = events[1]["manifest"]
        # Metadata-sensitive signature changes between skeleton and final.
        # structure_signature must NOT change.
        self.assertEqual(skeleton["structure_signature"], final["structure_signature"])


def test_layout_signature_tracks_size_not_dates(tmp_path):
    # Build two trees differing only in a file size, and two differing only in a date.
    def node(size, modified):
        return {
            "name": "a",
            "type": "file",
            "path": "a",
            "fullPath": "/r/a",
            "extension": "",
            "mediaKind": None,
            "size": size,
            "lines": 1,
            "binary": False,
            "dirty": False,
            "created": "2026-01-01T00:00:00Z",
            "modified": modified,
        }

    def tree(size, modified):
        return {
            "name": "r",
            "type": "directory",
            "path": ".",
            "fullPath": "/r",
            "children": [node(size, modified)],
            "children_count": 1,
            "children_file_count": 1,
            "children_dir_count": 0,
            "descendants_count": 1,
            "descendants_file_count": 1,
            "descendants_dir_count": 0,
            "descendants_size": size,
            "descendants_created_min": None,
            "descendants_modified_max": None,
            "descendants_ext_breakdown": [],
        }

    a = derive_tree_signals(tree(10, "2026-01-01T00:00:00Z"))
    b = derive_tree_signals(tree(20, "2026-01-01T00:00:00Z"))  # size changed
    c = derive_tree_signals(tree(10, "2026-09-09T00:00:00Z"))  # date changed
    assert a.layout_signature != b.layout_signature
    assert a.layout_signature == c.layout_signature
    assert (
        a.structure_signature == b.structure_signature == c.structure_signature
    )  # structure same
