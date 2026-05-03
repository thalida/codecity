"""Drift check: committed codecity/static/ must match a fresh `npm run build`.

The Python wheel ships codecity/static/ as bundled artifact, so users don't
need Node to install. That contract relies on the committed build matching
the current web/ source — if a frontend change lands without rerunning
`npm run build`, the published package serves stale JS/CSS.

This test does a fresh build into a tempdir and walks both trees,
comparing file contents byte-for-byte. Skipped when npm is not on PATH.
"""

from __future__ import annotations

import filecmp
import os
import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
STATIC_DIR = REPO_ROOT / "codecity" / "static"
WEB_DIR = REPO_ROOT / "web"


def _walk_files(root: Path) -> set[str]:
    """Return the set of file paths under ``root``, repo-relative."""
    files: set[str] = set()
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            full = Path(dirpath) / name
            files.add(str(full.relative_to(root)))
    return files


@unittest.skipIf(shutil.which("npm") is None, "npm not on PATH")
@unittest.skipIf(not (WEB_DIR / "node_modules").exists(), "web/node_modules missing — run (cd web && npm install)")
class StaticBuildDriftTests(unittest.TestCase):
    def test_committed_static_matches_fresh_build(self) -> None:
        with TemporaryDirectory() as tmp:
            tmp_out = Path(tmp) / "static"
            # `vite build --outDir <abs>` writes the bundle to our tmpdir
            # without touching the committed codecity/static/.
            subprocess.run(
                ["npx", "vite", "build", "--outDir", str(tmp_out), "--emptyOutDir"],
                cwd=str(WEB_DIR),
                check=True,
                capture_output=True,
            )

            committed = _walk_files(STATIC_DIR)
            fresh = _walk_files(tmp_out)

            extra_in_committed = committed - fresh
            missing_from_committed = fresh - committed
            self.assertFalse(
                extra_in_committed,
                f"files in codecity/static/ that a fresh build would not produce: "
                f"{sorted(extra_in_committed)} — run (cd web && npm run build) "
                f"and commit the result",
            )
            self.assertFalse(
                missing_from_committed,
                f"files a fresh build produces that are not committed: "
                f"{sorted(missing_from_committed)} — run (cd web && npm run build) "
                f"and commit the result",
            )

            mismatched: list[str] = []
            for rel in committed & fresh:
                if not filecmp.cmp(STATIC_DIR / rel, tmp_out / rel, shallow=False):
                    mismatched.append(rel)
            self.assertFalse(
                mismatched,
                f"files differ between codecity/static/ and a fresh build: "
                f"{sorted(mismatched)} — run (cd web && npm run build) and commit",
            )


if __name__ == "__main__":
    unittest.main()
