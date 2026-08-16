#!/usr/bin/env python3
"""Fail if app/src/types/manifest.generated.ts no longer matches the Pydantic
models it is generated from.

manifest.contract.ts already guards the hand-written manifest.ts against the
generated file. Nothing guarded the generated file against its own source, so
it could sit stale — and did: /api/manifest/cached shipped without ever
appearing in it.

Regenerates into a temp dir and diffs, so it never touches the working tree.
Run from the repo root; needs uv and npx, so it runs on the host, not in the
python container.
"""

from __future__ import annotations

import difflib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

COMMITTED = Path("app/src/types/manifest.generated.ts")


def main() -> int:
    for tool in ("uv", "npx"):
        if shutil.which(tool) is None:
            print(f"{tool} not on PATH; skipping", file=sys.stderr)
            return 0

    with tempfile.TemporaryDirectory() as tmp:
        schema = Path(tmp) / "openapi.json"
        generated = Path(tmp) / "manifest.generated.ts"

        schema.write_text(
            subprocess.run(
                ["uv", "run", "python", "scripts/gen_openapi.py"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout,
            encoding="utf-8",
        )
        subprocess.run(
            ["npx", "openapi-typescript", str(schema), "-o", str(generated)],
            cwd="app",
            capture_output=True,
            check=True,
        )
        # The committed copy is prettier-formatted and prettierignored, so
        # format the fresh one the same way or every line reads as changed.
        # --config explicitly: prettier resolves config from the FILE's
        # directory, and this one is in a temp dir with no .prettierrc, which
        # silently means double quotes and a whole-file diff.
        subprocess.run(
            [
                "npx",
                "prettier",
                "--write",
                "--ignore-path",
                "/dev/null",
                "--config",
                str(Path(".prettierrc.json").resolve()),
                str(generated),
            ],
            capture_output=True,
            check=True,
        )

        want = generated.read_text(encoding="utf-8")
        have = COMMITTED.read_text(encoding="utf-8")

    if want == have:
        return 0

    print(f"{COMMITTED} is out of date. Run `just gen-types`.\n", file=sys.stderr)
    diff = difflib.unified_diff(
        have.splitlines(keepends=True),
        want.splitlines(keepends=True),
        fromfile="committed",
        tofile="regenerated",
        n=2,
    )
    sys.stderr.writelines(list(diff)[:60])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
