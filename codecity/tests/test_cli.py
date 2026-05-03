"""Smoke tests for the codecity CLI."""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from codecity.cli import main

# Reuse the sample-repo fixture that test_scan.py builds.
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample-repo"


class CliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        os.environ["CODECITY_QUIET"] = "1"
        from codecity.tests.test_scan import _ensure_fixture
        _ensure_fixture()

    def test_help_exits_zero(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            main(["--help"])
        self.assertEqual(ctx.exception.code, 0)

    def test_version_flag(self) -> None:
        from codecity import __version__
        buf = io.StringIO()
        with self.assertRaises(SystemExit), redirect_stdout(buf):
            main(["--version"])
        self.assertIn(__version__, buf.getvalue())

    def test_no_args_prints_help_and_returns_1(self) -> None:
        # main([]) should print help and return non-zero rather than crash.
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = main([])
        self.assertEqual(rc, 1)

    def test_scan_subcommand_emits_valid_json(self) -> None:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = main(["scan", str(FIXTURE)])
        self.assertEqual(rc, 0)

        manifest = json.loads(buf.getvalue())
        self.assertIn("tree", manifest)
        self.assertIn("root", manifest)
        self.assertEqual(manifest["root"], str(FIXTURE.resolve()))


if __name__ == "__main__":
    unittest.main()
