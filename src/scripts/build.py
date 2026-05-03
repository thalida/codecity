#!/usr/bin/env python3
"""build.py — Fill the two placeholders in template.html and write output.

Replaces __MANIFEST__ and __PROJECT_NAME__ via str.replace — no regex, no
awk, no subprocess. JSON special chars (backslash, ampersand) pass through
unchanged. Visual config is bundled into the JS module (src/defaults.js)
and lives inside the template already, so no __CONFIG__ flow.

Invoked by codecity.py, or directly as a CLI:

    python3 build.py --project <name> --manifest <path>
                     --template <path> --output <path>
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def _log(msg: str) -> None:
    if os.environ.get("CODECITY_QUIET") != "1":
        print(f"[build] {msg}", file=sys.stderr, flush=True)


def build_html(
    project: str,
    manifest_file: Path,
    template_file: Path,
    output_file: Path,
) -> None:
    """Substitute placeholders in the template and write output.

    Raises FileNotFoundError if any input path is missing.
    """
    template_file = Path(template_file)
    manifest_file = Path(manifest_file)
    output_file = Path(output_file)

    if not template_file.is_file():
        raise FileNotFoundError(f"template not found: {template_file}")
    if not manifest_file.is_file():
        raise FileNotFoundError(f"manifest not found: {manifest_file}")

    _log(f"reading template ({template_file})")
    template = template_file.read_text()

    manifest_size = manifest_file.stat().st_size
    _log(f"inlining manifest ({manifest_size} bytes)")
    manifest = manifest_file.read_text().rstrip()

    _log(f"substituting project name ({project})")
    html = (
        template
        .replace("__MANIFEST__", manifest)
        .replace("__PROJECT_NAME__", project)
    )

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(html)


def _cli() -> int:
    p = argparse.ArgumentParser(
        description="Fill placeholders in template.html and write output.",
    )
    p.add_argument("--project",  required=True, help="Name shown in <title>.")
    p.add_argument("--manifest", required=True, type=Path, help="Manifest JSON path.")
    p.add_argument("--template", required=True, type=Path, help="Template HTML path.")
    p.add_argument("--output",   required=True, type=Path, help="Output HTML path.")
    args = p.parse_args()

    try:
        build_html(
            args.project,
            args.manifest,
            args.template,
            args.output,
        )
    except FileNotFoundError as e:
        print(f"build.py: {e}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
