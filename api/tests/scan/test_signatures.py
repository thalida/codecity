"""The three fingerprints: content_signature (via signature_tree),
structure_signature, and layout_signature."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any

import pytest

from api.models.manifest import DateRanges, DirNode, FileNode
from api.models.manifest import SignatureResponse
from api.scan.scanner import signature_tree
from api.scan.signatures import derive_tree_signals
from api.git import SourceRef
from api.tests.conftest import (
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
    make_dir_node,
    make_file_node,
)


def _date_tree(*files: tuple[str, str, str]) -> DirNode:
    """DirNode of (name, created, modified) files. `size` is pinned to 0 because
    derive_tree_signals reads every FileNode field in one pass."""
    return make_dir_node(
        ".",
        [
            make_file_node(name, created=created, modified=modified, size=0)
            for name, created, modified in files
        ],
    )


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
    assert derive_tree_signals(_date_tree(*files)).date_ranges == DateRanges(
        minCreated=min_c,
        maxCreated=max_c,
        minModified=min_m,
        maxModified=max_m,
    )


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
        self.assertEqual(s.content_signature, m.content_signature)

    def test_signature_matches_scan_tree_on_dirty_repo(self):
        # The two walks compute the dirty bit at different call sites, so a
        # dirty repo is where drift between them would hide.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            tracked = root / "tracked.py"
            tracked.write_text("x = 1\n")
            commit_all(root)
            tracked.write_text("x = 2\n")  # edit after commit: repo is dirty

            m = _final_manifest(str(root))
            s = signature_tree(str(root))
            self.assertEqual(s.content_signature, m.content_signature)

    def test_signature_response_shape(self):
        fields = set(SignatureResponse.model_fields)
        # Exactly these three — no tree / repo, which is the whole point.
        self.assertEqual(fields, {"scanned_at", "content_signature"})

    def test_signature_changes_when_tracked_file_changes(self):
        # Add a tracked file, signature must shift; remove it, restored.
        before = signature_tree(str(FIXTURE)).content_signature
        new_file = FIXTURE / "sig-test-temp.txt"
        new_file.write_text("hello")
        try:
            subprocess.check_call(
                ["git", "-C", str(FIXTURE), "add", str(new_file.name)]
            )
            after_add = signature_tree(str(FIXTURE)).content_signature
            self.assertNotEqual(before, after_add)
        finally:
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "HEAD", new_file.name],
                check=False,
                capture_output=True,
            )
            new_file.unlink(missing_ok=True)

    def test_signature_honors_codecityignore(self):
        # Editing .codecityignore must shift signature_tree's answer, and it
        # must still equal scan_tree's for the same root.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            target = root / "sig-noise-fixture"
            target.mkdir()
            (target / "x.txt").write_text("x")
            commit_all(root)
            ignore_file = root / ".codecityignore"

            # Without ignore file, target is visible.
            before_sig = signature_tree(str(root)).content_signature
            before_full = _final_manifest(str(root)).content_signature
            self.assertEqual(before_sig, before_full)

            # Add ignore entry, both signatures must shift in lockstep.
            ignore_file.write_text("sig-noise-fixture\n")
            after_sig = signature_tree(str(root)).content_signature
            after_full = _final_manifest(str(root)).content_signature
            self.assertEqual(after_sig, after_full)
            self.assertNotEqual(before_sig, after_sig)

    def test_signature_changes_with_dirty_path_set(self):
        # A mode-only edit moves no mtime, size or head_sha, and must STILL
        # shift the signature or a cached manifest serves a stale dirty flag.
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
            sig_one_dirty = signature_tree(str(root)).content_signature

            # git sees the mode flip as modified, but a.py's own mtime and
            # size are untouched and repo.dirty was already True.
            os.chmod(a, before_stat.st_mode | 0o111)
            after_stat = a.stat()
            self.assertEqual(before_stat.st_size, after_stat.st_size)
            self.assertEqual(before_stat.st_mtime, after_stat.st_mtime)

            sig_two_dirty = signature_tree(str(root)).content_signature
            self.assertNotEqual(sig_one_dirty, sig_two_dirty)


def _sig(tree: DirNode) -> str:
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

    def _make_tree(self, entries: list[Any], path: str = ".") -> DirNode:
        return make_dir_node(path, entries)

    def _make_file(
        self,
        path: str,
        size: int = 100,
        created: str = "2024-01-01T00:00:00Z",
        modified: str = "2024-01-01T00:00:00Z",
    ) -> FileNode:
        return make_file_node(path, size=size, created=created, modified=modified)

    def test_same_shape_same_metadata_produces_same_signature(self):
        tree = self._make_tree([self._make_file("a.py"), self._make_file("b.py")])
        self.assertEqual(_sig(tree), _sig(tree))

    def test_same_shape_different_metadata_produces_same_signature(self):
        # Metadata (size) must NOT affect structure_signature.
        tree_a = self._make_tree([self._make_file("a.py", size=100)])
        tree_b = self._make_tree([self._make_file("a.py", size=999)])
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
                self._make_tree([self._make_file("sub/b.py")], path="sub"),
            ]
        )
        self.assertNotEqual(_sig(tree_before), _sig(tree_after))

    def test_deterministic_across_repeated_calls(self):
        tree = self._make_tree(
            [
                self._make_file("a.py"),
                self._make_file("b.py"),
                self._make_tree([self._make_file("pkg/c.py")], path="pkg"),
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
        from api.scan.scanner import scan_tree

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            init_repo(root)
            (root / "hello.py").write_text("x = 1\n")
            (root / "world.py").write_text("y = 2\n")
            commit_all(root)
            events = list(scan_tree(td, SourceRef(td)))
        self.assertEqual(len(events), 3)
        skeleton_sig = events[0].manifest.structure_signature
        final_sig = events[-1].manifest.structure_signature
        self.assertEqual(
            skeleton_sig,
            final_sig,
            "skeleton and final manifests must carry the same structure_signature",
        )

    def test_structure_signature_stable_when_only_metadata_changes(self):
        """structure_signature must be unchanged when only file content/lines/binary
        differs — i.e., between skeleton and final phases."""
        from api.scan.scanner import scan_tree

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            init_repo(root)
            (root / "a.py").write_text("x = 1\n" * 100)
            commit_all(root)
            events = list(scan_tree(td, SourceRef(td)))
        skeleton = events[0].manifest
        final = events[1].manifest
        # Metadata-sensitive signature changes between skeleton and final.
        # structure_signature must NOT change.
        self.assertEqual(skeleton.structure_signature, final.structure_signature)


def test_layout_signature_tracks_size_not_dates(tmp_path):
    # Build two trees differing only in a file size, and two differing only in a date.
    def tree(size, modified):
        return make_dir_node(
            ".", [make_file_node("a", size=size, lines=1, modified=modified)]
        )

    a = derive_tree_signals(tree(10, "2026-01-01T00:00:00Z"))
    b = derive_tree_signals(tree(20, "2026-01-01T00:00:00Z"))  # size changed
    c = derive_tree_signals(tree(10, "2026-09-09T00:00:00Z"))  # date changed
    assert a.layout_signature != b.layout_signature
    assert a.layout_signature == c.layout_signature
    assert (
        a.structure_signature == b.structure_signature == c.structure_signature
    )  # structure same
