"""Tests for the allowed_roots trust set + path validation."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from api.security import (
    OutsideRootError,
    NoRootsRegisteredError,
    TrustStore,
)


class TrustStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        (self.root / "sub").mkdir(parents=True)
        (self.root / "sub" / "f.txt").write_text("hi")
        self.store = TrustStore()

    def test_no_roots_raises(self) -> None:
        with self.assertRaises(NoRootsRegisteredError):
            self.store.assert_inside(self.root / "sub" / "f.txt")

    def test_inside_registered_root_ok(self) -> None:
        self.store.register(self.root)
        resolved = self.store.assert_inside(self.root / "sub" / "f.txt")
        self.assertEqual(resolved, (self.root / "sub" / "f.txt").resolve())

    def test_outside_root_raises(self) -> None:
        self.store.register(self.root)
        outside = Path(self.tmp.name) / "elsewhere.txt"
        outside.write_text("x")
        with self.assertRaises(OutsideRootError):
            self.store.assert_inside(outside)
