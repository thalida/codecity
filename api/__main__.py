"""api CLI entrypoint.

    python -m api                Serve on :8080 (single uvicorn process).
    python -m api --port 8000    Override port.
    python -m api --reload       Auto-reload on source changes (dev only).
    python -m api --version      Print version.

SINGLE PROCESS by design — see api/security.py (the allowed_roots trust
set is in-memory; multi-worker would split it). No --workers flag.
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
    p.add_argument("--host", default="0.0.0.0", help="Bind host (default 0.0.0.0).")
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
