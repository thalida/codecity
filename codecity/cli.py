"""codecity CLI.

Subcommands:
    codecity PATH [...]                 shorthand for: codecity serve PATH
    codecity serve PATH [...]           scan, serve, open pywebview window
    codecity dev PATH [...]             dev mode — Vite + Python server
    codecity scan PATH [--output FILE]  debug — emit manifest JSON
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from codecity import __version__
from codecity.scan import scan_tree
from codecity.server import start_server

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
DEFAULT_API_PORT = 8765
VITE_PORT = 5173
VITE_READY_TIMEOUT = 30  # seconds

# argv[0] values that are real subcommands (vs. a path that should be
# rewritten to `serve PATH`) and value-less help/version flags.
_SUBCOMMANDS = {"serve", "dev", "scan"}
_PASSTHROUGH = {"-h", "--help", "--version"}


# ── Common scan args ─────────────────────────────────────────────────────────


def _add_scan_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("path", help="Directory to scan.")
    p.add_argument("--depth", type=int, default=None, help="Max directory depth.")
    p.add_argument("--include", default=None, help="Only include filenames matching this glob.")
    p.add_argument("--exclude", default=None, help="Skip filenames matching this glob.")
    p.add_argument(
        "--no-gitignore",
        dest="gitignore",
        action="store_false",
        help="Include files even if .gitignored.",
    )
    p.set_defaults(gitignore=True)


def _scan_from_args(args: argparse.Namespace) -> dict:
    return scan_tree(
        args.path,
        depth=args.depth,
        include=args.include,
        exclude=args.exclude,
        gitignore=args.gitignore,
    )


# ── Commands ─────────────────────────────────────────────────────────────────


def cmd_scan(args: argparse.Namespace) -> int:
    manifest = _scan_from_args(args)
    payload = json.dumps(manifest, separators=(",", ":"))
    if args.output and args.output != "-":
        Path(args.output).write_text(payload)
    else:
        sys.stdout.write(payload)
        sys.stdout.write("\n")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Scan, serve static, open pywebview."""
    from codecity.webview import launch

    manifest = _scan_from_args(args)
    scan_root = Path(args.path).resolve()

    _, port, shutdown = start_server(manifest, port=args.port, scan_root=scan_root)
    url = f"http://127.0.0.1:{port}/"
    print(f"[codecity] serving on {url}", file=sys.stderr)

    if args.no_window:
        print("[codecity] running headless — Ctrl-C to stop", file=sys.stderr)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        finally:
            shutdown()
        return 0

    try:
        launch(
            url,
            title=f"CodeCity — {Path(args.path).resolve().name}",
            debug=getattr(args, "debug", False),
        )
    finally:
        shutdown()
    return 0


def cmd_dev(args: argparse.Namespace) -> int:
    """Scan, run Python server on 8765, spawn Vite, open pywebview pointed at
    Vite (which proxies /api/* back to Python)."""
    from codecity.webview import launch

    if shutil.which("npm") is None:
        print("error: 'npm' not found on PATH; required for dev mode", file=sys.stderr)
        return 2

    manifest = _scan_from_args(args)
    scan_root = Path(args.path).resolve()

    _, port, shutdown = start_server(
        manifest, port=DEFAULT_API_PORT, scan_root=scan_root
    )
    print(f"[codecity] api server on http://127.0.0.1:{port}", file=sys.stderr)

    vite_proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(WEB_DIR),
        stdout=sys.stderr,
        stderr=sys.stderr,
        start_new_session=True,
    )

    try:
        if not _wait_for_url(f"http://127.0.0.1:{VITE_PORT}/", VITE_READY_TIMEOUT):
            print("error: Vite did not become ready in time", file=sys.stderr)
            return 3
        launch(
            f"http://127.0.0.1:{VITE_PORT}/",
            title=f"CodeCity (dev) — {Path(args.path).resolve().name}",
            debug=getattr(args, "debug", False),
        )
    finally:
        if vite_proc.poll() is None:
            try:
                os.killpg(os.getpgid(vite_proc.pid), signal.SIGTERM)
                vite_proc.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                pass
        shutdown()
    return 0


def _wait_for_url(url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if 200 <= resp.status < 500:
                    return True
        except (urllib.error.URLError, urllib.error.HTTPError, ConnectionError):
            time.sleep(0.25)
    return False


# ── Parser ───────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="codecity",
        description="Visualize a codebase as an isometric 3D city.",
    )
    p.add_argument("--version", action="version", version=f"codecity {__version__}")

    sub = p.add_subparsers(dest="command")

    p_serve = sub.add_parser("serve", help="Scan and open a window (default action).")
    _add_scan_args(p_serve)
    p_serve.add_argument("--port", type=int, default=0, help="HTTP port (0 = OS picks).")
    p_serve.add_argument(
        "--no-window",
        action="store_true",
        help="Skip opening the PyWebView window; serve only.",
    )
    p_serve.add_argument(
        "--debug",
        action="store_true",
        help="Open the PyWebView window with developer tools enabled.",
    )
    p_serve.set_defaults(func=cmd_serve)

    p_dev = sub.add_parser("dev", help="Run with Vite dev server + HMR.")
    _add_scan_args(p_dev)
    p_dev.add_argument("--debug", action="store_true", help="Enable webview dev tools.")
    p_dev.set_defaults(func=cmd_dev)

    p_scan = sub.add_parser("scan", help="Emit the scanned manifest as JSON.")
    _add_scan_args(p_scan)
    p_scan.add_argument(
        "--output",
        default="-",
        help="Write JSON here; '-' for stdout (default).",
    )
    p_scan.set_defaults(func=cmd_scan)

    return p


def _normalize_argv(argv: list[str]) -> list[str]:
    """If the first arg looks like a path (not a subcommand or top-level
    flag), rewrite to `serve PATH ...` so `codecity .` works as shorthand
    for `codecity serve .`."""
    if not argv:
        return argv
    first = argv[0]
    if first in _SUBCOMMANDS or first in _PASSTHROUGH:
        return argv
    return ["serve", *argv]


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    argv = _normalize_argv(argv)

    parser = _build_parser()
    args = parser.parse_args(argv)

    if not getattr(args, "command", None):
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
