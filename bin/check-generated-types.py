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


def run(argv: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    """Run `argv`, surfacing its stderr if it fails.

    check=True alone raises a CalledProcessError naming only the command, so a
    captured failure reaches CI as an exit code and no reason at all."""
    result = subprocess.run(argv, capture_output=True, text=True, **kwargs)  # type: ignore[call-overload]
    if result.returncode != 0:
        print(f"$ {' '.join(argv)}", file=sys.stderr)
        print(result.stderr or result.stdout, file=sys.stderr)
        raise SystemExit(result.returncode)
    return result


def main() -> int:
    for tool in ("uv", "npx"):
        if shutil.which(tool) is None:
            print(f"{tool} not on PATH; skipping", file=sys.stderr)
            return 0

    with tempfile.TemporaryDirectory() as tmp:
        schema = Path(tmp) / "openapi.json"
        generated = Path(tmp) / "manifest.generated.ts"

        schema.write_text(
            run(["uv", "run", "python", "scripts/gen_openapi.py"]).stdout,
            encoding="utf-8",
        )
        # --no-install: npx would otherwise fetch latest, and the file would
        # then differ by generator version rather than by drift in the models.
        run(
            [
                "npx",
                "--no-install",
                "openapi-typescript",
                str(schema),
                "-o",
                str(generated),
            ],
            cwd="app",
        )
        # Format the fresh copy the way the committed one is, or every line
        # reads as changed. --config because prettier resolves it per-FILE.
        run(
            [
                "npx",
                "--no-install",
                "prettier",
                "--write",
                "--ignore-path",
                "/dev/null",
                "--config",
                str(Path(".prettierrc.json").resolve()),
                str(generated),
            ]
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
