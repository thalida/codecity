"""codecity CLI.

Commands:
    codecity PATH [--dev] [...]         shorthand for: codecity serve PATH
    codecity serve PATH [--dev] [...]   scan, serve, open pywebview window
    codecity scan PATH [--output FILE]  debug — emit manifest JSON

Pass --dev to spawn Vite (HMR) instead of serving the committed static
build.
"""

from __future__ import annotations

import argparse
import atexit
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
_SUBCOMMANDS = {"serve", "scan"}
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
    """Default action. With --dev, runs Vite + HMR; otherwise serves the
    committed static build."""
    if getattr(args, "dev", False):
        return _serve_dev(args)
    return _serve_prod(args)


def _serve_prod(args: argparse.Namespace) -> int:
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


def _serve_dev(args: argparse.Namespace) -> int:
    """Spawn Vite + Python server, point pywebview at Vite (HMR-enabled).

    Cleanup is layered so Vite always dies with us:
      - signal handlers for SIGINT/SIGTERM that kill the Vite process group
        and exit immediately (pywebview's macOS event loop swallows
        Python-level KeyboardInterrupt, so the regular try/finally path
        wouldn't run on Ctrl-C);
      - atexit hook as a last-resort backstop for any other exit path;
      - the original try/finally still handles the normal "user closed the
        window" exit, where the cleanup is graceful + waits for Vite.
    """
    from codecity.webview import launch

    if shutil.which("npm") is None:
        print("error: 'npm' not found on PATH; required for --dev", file=sys.stderr)
        return 2
    if not (WEB_DIR / "node_modules").exists():
        print(
            "error: web/node_modules missing — run (cd web && npm install) first",
            file=sys.stderr,
        )
        return 2

    # Pre-flight: surface a clear error (with PID if we can find it) when
    # something else is holding 5173 instead of letting Vite fail opaquely.
    holder = _port_holder(VITE_PORT)
    if holder is not None:
        print(
            f"error: port {VITE_PORT} is held by PID {holder}. "
            f"Free it with: kill {holder}",
            file=sys.stderr,
        )
        return 4

    manifest = _scan_from_args(args)
    scan_root = Path(args.path).resolve()

    _, port, shutdown = start_server(
        manifest, port=DEFAULT_API_PORT, scan_root=scan_root
    )
    print(f"[codecity] api server on http://127.0.0.1:{port}", file=sys.stderr)
    print(f"[codecity] starting Vite on :{VITE_PORT}…", file=sys.stderr)

    vite_proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(WEB_DIR),
        stdout=sys.stderr,
        stderr=sys.stderr,
        start_new_session=True,
    )

    # Belt-and-suspenders cleanup: signal handlers + atexit. The signal
    # handlers cover Ctrl-C / `kill PID` (which pywebview's run loop
    # otherwise eats); atexit covers everything else (uncaught exception,
    # interpreter shutdown).
    def _cleanup() -> None:
        _kill_vite(vite_proc)
        try:
            shutdown()
        except Exception:  # pylint: disable=broad-except
            pass

    def _signal_handler(signum: int, _frame) -> None:  # noqa: ANN001
        _cleanup()
        os._exit(130 if signum == signal.SIGINT else 143)

    atexit.register(_cleanup)
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    try:
        if not _wait_for_vite(f"http://127.0.0.1:{VITE_PORT}/", vite_proc):
            return 3
        launch(
            f"http://127.0.0.1:{VITE_PORT}/",
            title=f"CodeCity (dev) — {Path(args.path).resolve().name}",
            debug=getattr(args, "debug", False),
        )
    finally:
        _cleanup()
    return 0


def _kill_vite(vite_proc: subprocess.Popen) -> None:
    """Tear down the Vite process group. Idempotent, exception-safe."""
    if vite_proc.poll() is not None:
        return
    try:
        pgid = os.getpgid(vite_proc.pid)
    except ProcessLookupError:
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
        vite_proc.wait(timeout=5)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def _port_holder(port: int) -> int | None:
    """Return the PID currently bound to ``port`` on 127.0.0.1, or None.

    Uses ``lsof`` since it's universally available on macOS / most Linux
    distros and gives us the PID directly. Falls back silently when lsof
    isn't on PATH — caller treats that as "port is free, let Vite try"."""
    if shutil.which("lsof") is None:
        return None
    try:
        out = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    pids = [int(p) for p in out.stdout.split() if p.strip().isdigit()]
    return pids[0] if pids else None


def _wait_for_vite(url: str, vite_proc: subprocess.Popen) -> bool:
    """Block until Vite responds on ``url``, or until it exits early.

    Polling ``vite_proc.poll()`` lets us surface "Vite died on startup"
    immediately (e.g. port 5173 already in use with strictPort), instead
    of waiting out the full ready timeout."""
    deadline = time.monotonic() + VITE_READY_TIMEOUT
    while time.monotonic() < deadline:
        rc = vite_proc.poll()
        if rc is not None:
            print(
                f"error: Vite exited with code {rc} before becoming ready — "
                f"likely port {VITE_PORT} is already in use; "
                f"check `lsof -i :{VITE_PORT}` and try again",
                file=sys.stderr,
            )
            return False
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if 200 <= resp.status < 500:
                    return True
        except (urllib.error.URLError, urllib.error.HTTPError, ConnectionError):
            time.sleep(0.25)
    print(
        f"error: Vite did not become ready within {VITE_READY_TIMEOUT}s",
        file=sys.stderr,
    )
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
    p_serve.add_argument(
        "--dev",
        action="store_true",
        help="Run via Vite dev server with frontend HMR.",
    )
    p_serve.set_defaults(func=cmd_serve)

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
