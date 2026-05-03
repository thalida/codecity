#!/usr/bin/env python3
"""codecity.py — CodeCity skill entry point.

Usage:
    python3 skills/codecity/codecity.py \\
        --root <path> --output <out.html> \\
        [--depth N] [--include PAT] [--exclude PAT] [--no-gitignore]

    python3 src/codecity.py --dev --root <path> [filter flags]      # dev only

One-shot mode: scans the target, fills template.html with the manifest, and
writes a self-contained HTML to --output. Visual defaults are bundled into
the JS module (src/defaults.js) — no separate config file flows through.

Dev mode: scans once into build/ (gitignored) and exec's `npx vite` with
CODECITY_* env vars set so vite's dev-inject plugin can read them.

Dependencies: python3 ≥ 3.9, git. Node/vite only for --dev mode.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

# Make `from scripts.scan import ...` work regardless of which directory
# codecity.py runs from (src/ or skills/codecity/).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scripts.scan import scan_tree  # noqa: E402
from scripts.build import build_html  # noqa: E402


# ── Progress logging ─────────────────────────────────────────────────────────

_T_START = time.monotonic()


def _log(msg: str) -> None:
    if os.environ.get("CODECITY_QUIET") == "1":
        return
    elapsed = int(time.monotonic() - _T_START)
    print(f"[codecity {elapsed:4d}s] {msg}", file=sys.stderr, flush=True)


# ── Args ─────────────────────────────────────────────────────────────────────


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="codecity.py",
        description="Scan a directory and build an isometric 3D city HTML.",
    )
    p.add_argument("--root", required=True, help="Directory to scan.")
    p.add_argument("--output", help="Where to write the HTML (required unless --dev).")
    p.add_argument("--depth", type=int, default=None, help="Max directory depth.")
    p.add_argument("--include", default=None, help="Only filenames matching this glob.")
    p.add_argument("--exclude", default=None, help="Skip filenames matching this glob.")
    p.add_argument("--no-gitignore", dest="gitignore", action="store_false",
                   help="Include files even if .gitignored.")
    p.add_argument("--dev", action="store_true",
                   help="Dev mode: scan + exec `npx vite` for HMR instead of writing HTML.")
    p.set_defaults(gitignore=True)

    args = p.parse_args(argv)
    if not args.dev and not args.output:
        p.error("--output is required (or use --dev)")
    return args


# ── Main ─────────────────────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    args = _parse_args(argv)

    # codecity.py runs from either:
    #   • src/codecity.py              (dev — scripts/* siblings)
    #   • skills/codecity/codecity.py  (shipped — plus template.html)
    here = Path(__file__).resolve().parent
    template = here / "template.html"

    if not args.dev and not template.is_file():
        print(f"template.html not found: {template}", file=sys.stderr)
        print("One-shot mode needs the shipped template. Run 'npm run build' or use --dev.",
              file=sys.stderr)
        return 3

    project = Path(args.root).resolve().name
    _log(f"project: {project}")
    _log(f"root:    {Path(args.root).resolve()}")
    if args.depth is not None:
        _log(f"depth:   {args.depth}")
    if args.include:
        _log(f"include: {args.include}")
    if args.exclude:
        _log(f"exclude: {args.exclude}")
    if not args.gitignore:
        _log("gitignore: off")
    _log(f"mode:    {'dev (vite HMR)' if args.dev else f'one-shot → {args.output}'}")

    _log("scanning…")
    scan_start = time.monotonic()
    manifest = scan_tree(
        args.root,
        depth=args.depth,
        include=args.include,
        exclude=args.exclude,
        gitignore=args.gitignore,
    )
    scan_dt = int(time.monotonic() - scan_start)
    tree = manifest.get("tree", {})
    files = tree.get("descendants_file_count", "?")
    dirs = tree.get("descendants_dir_count", "?")
    _log(f"scanned  {files} files, {dirs} dirs ({scan_dt}s)")

    # ── Dev mode: write manifest to build/, exec vite ─────────────
    if args.dev:
        repo_root = here.parent
        dev_dir = repo_root / "build"
        dev_dir.mkdir(parents=True, exist_ok=True)
        manifest_file = dev_dir / "manifest.json"
        manifest_file.write_text(json.dumps(manifest, separators=(",", ":")))

        os.environ["CODECITY_MANIFEST"] = str(manifest_file)
        os.environ["CODECITY_PROJECT"] = project

        _log("starting vite dev server (Ctrl-C to stop)…")
        os.chdir(repo_root)
        os.execvp("npx", ["npx", "vite"])
        # execvp replaces this process; unreached.
        return 0

    # ── One-shot mode: scan → tmp → build → output ──────────────────────────
    with tempfile.TemporaryDirectory() as tmpdir_str:
        tmpdir = Path(tmpdir_str)
        manifest_file = tmpdir / "manifest.json"
        manifest_file.write_text(json.dumps(manifest, separators=(",", ":")))

        _log("writing HTML…")
        build_start = time.monotonic()
        build_html(project, manifest_file, template, Path(args.output))
        out_size = Path(args.output).stat().st_size
        build_dt = int(time.monotonic() - build_start)
        _log(f"built    {args.output} ({out_size // 1024} KB, {build_dt}s)")

    total = int(time.monotonic() - _T_START)
    _log(f"done     total {total}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
