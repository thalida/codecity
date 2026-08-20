"""api CLI entrypoint.

    python -m api                    Serve on 127.0.0.1:8080 (single process).
    python -m api --port 8000        Override port.
    python -m api --host 0.0.0.0     Expose on the network (see --host below).
    python -m api --reload           Auto-reload on source changes (dev only).
    python -m api --version          Print version.

SINGLE PROCESS by design — clone.py serializes clone-or-update on an in-process
lock, and a second worker would fetch the same working tree underneath the first.
No --workers flag.
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional

import uvicorn

from api import __version__


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="codecity",
        description="Visualize a codebase as an isometric 3D city.",
    )
    p.add_argument("--version", action="version", version=f"codecity {__version__}")
    p.add_argument("--port", type=int, default=8080, help="HTTP port (default 8080).")
    # Loopback by default: the API is unauthenticated and /api/file serves anything
    # under a scanned root. Containers pass --host 0.0.0.0 (their own namespace).
    p.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind host (default 127.0.0.1; use 0.0.0.0 to expose on the network).",
    )
    p.add_argument("--reload", action="store_true", help="Auto-reload (dev only).")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    uvicorn.run(
        "api.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        reload_dirs=["api"] if args.reload else None,
        workers=1,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
