"""api CLI entrypoint.

Surface:
    python -m api                       Serve on :8080.
    python -m api --port 8000           Override port.
    python -m api --reload              Auto-reload on .py changes (dev only).
    python -m api --version             Print version.

The container ENTRYPOINT runs `python -m api`, so this is the only entrypoint
in production. Dev mode uses --reload via docker-compose.dev.yml.

Port + browser-opening logic that lived in the old cli.py is now external:
Docker handles port mapping (-p HOST:CONTAINER), and end users open the URL
themselves.
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
from typing import Optional

from api import __version__


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="codecity",
        description="Visualize a codebase as an isometric 3D city.",
    )
    p.add_argument("--version", action="version", version=f"codecity {__version__}")
    p.add_argument(
        "--port",
        type=int,
        default=8080,
        help="HTTP port to listen on (default: 8080).",
    )
    p.add_argument(
        "--reload",
        action="store_true",
        help="Watch api/**/*.py and re-exec on change (dev only).",
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    args = _build_parser().parse_args(argv)

    if args.reload:
        # Defer the import — keeps watchfiles off the cold-start import graph
        # for `codecity --version` / `--help` / non-reload runs.
        try:
            from api._reload import run_with_reload
        except ImportError:
            print(
                "error: --reload is not yet wired up. "
                "Use docker compose -f docker-compose.dev.yml up for dev mode.",
                file=sys.stderr,
            )
            return 2
        return run_with_reload(port=args.port)

    return _serve(port=args.port)


def _serve(port: int) -> int:
    from api.server import start_server

    _, bound, shutdown = start_server(port=port, host="0.0.0.0")
    print(
        f"[codecity] listening on http://0.0.0.0:{bound}/",
        file=sys.stderr,
        flush=True,
    )
    print("[codecity] Ctrl-C to stop", file=sys.stderr, flush=True)

    stop_event = threading.Event()

    def _handle_signal(signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        stop_event.wait()
    finally:
        shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
