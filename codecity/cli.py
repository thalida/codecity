"""codecity CLI — process launcher only.

Surface:
    codecity              Start the prod HTTP server, open the browser.
    codecity --dev        Start the Vite dev server + Python API, open the browser.
    codecity --port N     Override the server port. Prod: Python server port.
                          Dev: Vite port (Python API stays on 8765 internally).

All source-selection (path / git URL / branch) happens in the browser UI.
"""

from __future__ import annotations

import argparse
import atexit
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from types import FrameType
from typing import Optional

from codecity import __version__
from codecity.server import start_server

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
DEFAULT_API_PORT = 8765
DEFAULT_VITE_PORT = 5173
VITE_READY_TIMEOUT = 30  # seconds


def _serve_prod(port: int) -> int:
    _, bound, shutdown = start_server(port=port or 0)
    url = f"http://127.0.0.1:{bound}/"
    print(f"[codecity] serving on {url}", file=sys.stderr)
    webbrowser.open(url)
    print("[codecity] Ctrl-C to stop", file=sys.stderr)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\n[codecity] stopping…", file=sys.stderr)
    finally:
        shutdown()
    return 0


def _serve_dev(port: int) -> int:
    if shutil.which("npm") is None:
        print("error: 'npm' not found on PATH; required for --dev", file=sys.stderr)
        return 2
    if not (WEB_DIR / "node_modules").exists():
        print(
            "error: web/node_modules missing — run (cd web && npm install) first",
            file=sys.stderr,
        )
        return 2

    vite_port = port or DEFAULT_VITE_PORT
    holder = _port_holder(vite_port)
    if holder is not None:
        print(
            f"error: port {vite_port} is held by PID {holder}. "
            f"Free it with: kill {holder}",
            file=sys.stderr,
        )
        return 4

    _, api_port, shutdown = start_server(port=DEFAULT_API_PORT)
    print(f"[codecity] api server on http://127.0.0.1:{api_port}", file=sys.stderr)
    print(f"[codecity] starting Vite on :{vite_port}…", file=sys.stderr)

    vite_proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(vite_port)],
        cwd=str(WEB_DIR),
        stdout=sys.stderr,
        stderr=sys.stderr,
        start_new_session=True,
    )

    def _cleanup() -> None:
        _kill_vite(vite_proc)
        try:
            shutdown()
        except Exception:  # pylint: disable=broad-except
            pass

    def _signal_handler(signum: int, _frame: FrameType | None) -> None:
        _cleanup()
        os._exit(130 if signum == signal.SIGINT else 143)

    atexit.register(_cleanup)
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    try:
        if not _wait_for_vite(f"http://127.0.0.1:{vite_port}/", vite_proc, vite_port):
            return 3
        url = f"http://127.0.0.1:{vite_port}/"
        webbrowser.open(url)
        print(f"[codecity] open {url} — Ctrl-C to stop", file=sys.stderr)
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        _cleanup()
    return 0


def _kill_vite(vite_proc: "subprocess.Popen[bytes]") -> None:
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


def _wait_for_vite(
    url: str, vite_proc: "subprocess.Popen[bytes]", port: int
) -> bool:
    deadline = time.monotonic() + VITE_READY_TIMEOUT
    while time.monotonic() < deadline:
        rc = vite_proc.poll()
        if rc is not None:
            print(
                f"error: Vite exited with code {rc} before becoming ready — "
                f"likely port {port} is already in use; "
                f"check `lsof -i :{port}` and try again",
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


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="codecity",
        description="Visualize a codebase as an isometric 3D city. "
                    "Pick the source in the browser.",
    )
    p.add_argument("--version", action="version", version=f"codecity {__version__}")
    p.add_argument(
        "--dev",
        action="store_true",
        help="Run via Vite dev server with frontend HMR.",
    )
    p.add_argument(
        "--port",
        type=int,
        default=0,
        help="Override the server port. Prod: Python server port. "
             "Dev: Vite port (Python API stays on 8765 internally).",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.dev:
        return _serve_dev(args.port)
    return _serve_prod(args.port)


if __name__ == "__main__":
    raise SystemExit(main())
