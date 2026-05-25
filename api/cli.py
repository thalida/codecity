"""codecity CLI — process launcher only.

Surface:
    codecity                    Start the prod HTTP server, open the browser.
    codecity --dev              Start the Vite dev server + Python API.
    codecity --port N           Override the prod HTTP port (or Vite port in
                                --dev) and persist it to .local/worktree-ports.json.
    codecity --api-port N       Override the Python API port in --dev mode
                                (persisted to .local/worktree-ports.json).

Both modes auto-select free ports, save them to .local/worktree-ports.json so
the same URLs survive restarts within the same worktree, and open the browser
at http://<repo>.localhost:<port>/.

All source-selection (path / git URL / branch) happens in the browser UI.
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from types import FrameType
from typing import Optional

from api import __version__
from api.server import start_server

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
PORTS_FILE = REPO_ROOT / ".local" / "worktree-ports.json"
VITE_READY_TIMEOUT = 30  # seconds

_PORT_KEYS = ("vite_port", "api_port", "prod_port")


def _find_free_port(reserved: set[int] | None = None) -> int:
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        if reserved is None or port not in reserved:
            return port


def _other_worktree_ports() -> set[int]:
    """Return ports saved by every worktree except the current one."""
    try:
        result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            check=True, capture_output=True, text=True,
            cwd=str(REPO_ROOT), timeout=5,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return set()
    ports: set[int] = set()
    current = REPO_ROOT.resolve()
    for line in result.stdout.splitlines():
        if not line.startswith("worktree "):
            continue
        wt = Path(line[len("worktree "):].strip()).resolve()
        if wt == current:
            continue
        try:
            data = json.loads((wt / ".local" / "worktree-ports.json").read_text())
            for key in _PORT_KEYS:
                if key in data:
                    ports.add(int(data[key]))
        except (FileNotFoundError, ValueError, json.JSONDecodeError):
            pass
    return ports


def _load_worktree_ports() -> dict[str, int]:
    try:
        data = json.loads(PORTS_FILE.read_text())
        return {k: int(data[k]) for k in _PORT_KEYS if k in data}
    except (FileNotFoundError, ValueError, json.JSONDecodeError):
        return {}


def _save_worktree_ports(ports: dict[str, int]) -> None:
    PORTS_FILE.parent.mkdir(exist_ok=True)
    PORTS_FILE.write_text(json.dumps(ports))


def _repo_label() -> str:
    return REPO_ROOT.name.lower().replace("_", "-")


def _resolve_port(
    key: str,
    override: int,
    reserved: set[int],
    saved: dict[str, int],
) -> int | None:
    """Resolve a port: explicit override > saved (if still free) > new free port.

    Returns None if the override is held by another process (caller should
    surface an error). The reserved set is mutated to include the chosen port
    so a subsequent call in the same run won't pick the same number.
    """
    if override:
        if _port_holder(override) is not None:
            return None
        reserved.add(override)
        return override
    port = saved.get(key)
    if port and _port_holder(port) is None and port not in reserved:
        reserved.add(port)
        return port
    port = _find_free_port(reserved)
    reserved.add(port)
    return port


def _override_error(port: int) -> int:
    holder = _port_holder(port)
    print(
        f"error: port {port} is held by PID {holder}. "
        f"Free it with: kill {holder}",
        file=sys.stderr,
    )
    return 4


def _serve_prod(override_port: int) -> int:
    reserved = _other_worktree_ports()
    saved = _load_worktree_ports()
    port = _resolve_port("prod_port", override_port, reserved, saved)
    if port is None:
        return _override_error(override_port)
    saved["prod_port"] = port
    _save_worktree_ports(saved)
    _, bound, shutdown = start_server(port=port)
    url = f"http://{_repo_label()}.localhost:{bound}/"
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


def _serve_dev(override_vite_port: int, override_api_port: int) -> int:
    reserved = _other_worktree_ports()
    saved = _load_worktree_ports()
    vite_port = _resolve_port("vite_port", override_vite_port, reserved, saved)
    if vite_port is None:
        return _override_error(override_vite_port)
    api_port = _resolve_port("api_port", override_api_port, reserved, saved)
    if api_port is None:
        return _override_error(override_api_port)
    saved["vite_port"] = vite_port
    saved["api_port"] = api_port
    _save_worktree_ports(saved)
    print(f"[codecity] worktree ports: Vite={vite_port} API={api_port}", file=sys.stderr)
    return _run_dev_server(vite_port, api_port)


def _run_dev_server(vite_port: int, api_port: int) -> int:
    if shutil.which("npm") is None:
        print("error: 'npm' not found on PATH; required for --dev", file=sys.stderr)
        return 2
    if not (WEB_DIR / "node_modules").exists():
        print(
            "error: web/node_modules missing — run (cd web && npm install) first",
            file=sys.stderr,
        )
        return 2

    _, actual_api_port, shutdown = start_server(port=api_port)
    print(f"[codecity] api server on http://127.0.0.1:{actual_api_port}", file=sys.stderr)
    print(f"[codecity] starting Vite on :{vite_port}…", file=sys.stderr)

    env = {**os.environ, "VITE_API_PORT": str(actual_api_port)}
    vite_proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(vite_port)],
        cwd=str(WEB_DIR),
        env=env,
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
        if not _wait_for_vite(f"http://[::1]:{vite_port}/", vite_proc, vite_port):
            return 3
        url = f"http://{_repo_label()}.localhost:{vite_port}/"
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
        help="Run via Vite dev server with frontend HMR; auto-selects free ports.",
    )
    p.add_argument(
        "--port",
        type=int,
        default=0,
        help="Override the prod HTTP port (or Vite port in --dev) and persist "
             "it to .local/worktree-ports.json.",
    )
    p.add_argument(
        "--api-port",
        type=int,
        default=0,
        dest="api_port",
        help="Override the Python API port in --dev mode (persisted to "
             ".local/worktree-ports.json).",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.dev:
        return _serve_dev(args.port, args.api_port)
    return _serve_prod(args.port)


if __name__ == "__main__":
    raise SystemExit(main())
