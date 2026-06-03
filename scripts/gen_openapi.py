"""Dump the OpenAPI schema to stdout without starting a server.

Usage: uv run python scripts/gen_openapi.py > openapi.json
"""
from __future__ import annotations

import json
import sys

from api.app import create_app


def main() -> int:
    app = create_app()
    json.dump(app.openapi(), sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
