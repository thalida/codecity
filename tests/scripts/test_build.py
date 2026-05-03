"""Unit tests for src/scripts/build.py.

Run with:
    python3 -m unittest discover -s tests/scripts -p 'test_*.py'
    python3 -m unittest tests.scripts.test_build
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

from scripts.build import build_html  # noqa: E402


os.environ["CODECITY_QUIET"] = "1"


TEMPLATE_TEXT = """<!DOCTYPE html>
<html><head><title>CodeCity — __PROJECT_NAME__</title></head>
<body>
  <canvas id="city"></canvas>
  <script type="application/json" id="codecity-manifest">__MANIFEST__</script>
</body></html>
"""


class BuildHtmlTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.addCleanup(self._cleanup)
        self.template = self.tmpdir / "template.html"
        self.manifest = self.tmpdir / "manifest.json"
        self.output = self.tmpdir / "out.html"
        self.template.write_text(TEMPLATE_TEXT)
        self.manifest.write_text('{"root":"test","tree":{"name":"test","children":[]}}')

    def _cleanup(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_replaces_both_tokens(self):
        build_html("MyProject", self.manifest, self.template, self.output)
        html = self.output.read_text()
        self.assertIn("CodeCity — MyProject", html)
        self.assertIn('"root":"test"', html)
        self.assertNotIn("__PROJECT_NAME__", html)
        self.assertNotIn("__MANIFEST__", html)

    def test_script_tag_wrapper_survives(self):
        build_html("p", self.manifest, self.template, self.output)
        html = self.output.read_text()
        self.assertIn('<script type="application/json" id="codecity-manifest">', html)

    def test_json_special_chars_preserved(self):
        self.manifest.write_text(r'{"root":"te\\st","tree":{"name":"a & b","children":[]}}')
        build_html("p&amp", self.manifest, self.template, self.output)
        html = self.output.read_text()
        self.assertIn(r"te\\st", html)
        self.assertIn('"a & b"', html)
        self.assertIn("CodeCity — p&amp", html)

    def test_raises_for_missing_template(self):
        bogus = self.tmpdir / "does-not-exist.html"
        with self.assertRaises(FileNotFoundError):
            build_html("p", self.manifest, bogus, self.output)

    def test_raises_for_missing_manifest(self):
        bogus = self.tmpdir / "does-not-exist.json"
        with self.assertRaises(FileNotFoundError):
            build_html("p", bogus, self.template, self.output)

    def test_creates_output_parent_dir(self):
        nested = self.tmpdir / "a" / "b" / "out.html"
        build_html("p", self.manifest, self.template, nested)
        self.assertTrue(nested.is_file())


if __name__ == "__main__":
    unittest.main()
