#!/usr/bin/env python3
"""Cap how long a Python comment block may run — the `#` half of the rule
packages/app/eslint-rules/comment-length.js enforces on JS and CSS.

Density is the point: a long block buries the one non-obvious fact in it.

Usage: check-comments.py [--max N] [--header N] <path>...

Matches the eslint rule where the languages match:
  - own-line comments only; a note trailing code is one line by construction
  - consecutive own-line comments count as ONE block, so the cap can't be
    sidestepped by inserting a blank line mid-thought
  - tooling directives are machine-readable, not prose, and are exempt
  - the file header gets more room: it names the module's whole job

Docstrings are deliberately NOT capped. In JS the equivalent of a docstring is
a `/** */` block and the eslint rule does cap it, but Python docstrings are the
API surface — pyright, IDEs and `help()` all read them — so they are
documentation rather than inline commentary, and the density argument does not
apply to them.
"""

from __future__ import annotations

import argparse
import io
import sys
import tokenize
from pathlib import Path

# Machine-readable pragmas, not prose.
_DIRECTIVES = (
    "noqa",
    "type:",
    "pragma:",
    "ruff:",
    "pyright:",
    "mypy:",
    "fmt:",
    "isort:",
    "!",  # shebang
)


def _is_directive(text: str) -> bool:
    body = text.lstrip("#").strip()
    return body.startswith(_DIRECTIVES)


def violations(path: Path, *, max_lines: int, header_lines: int) -> list[str]:
    """Every over-long comment block in `path`, as ready-to-print messages."""
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines()
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError) as e:
        return [f"{path}: could not tokenize ({e})"]

    # (start_line, end_line, is_directive) per own-line comment run.
    blocks: list[tuple[int, int, bool]] = []
    for tok in tokens:
        if tok.type != tokenize.COMMENT:
            continue
        row = tok.start[0]
        if lines[row - 1][: tok.start[1]].strip():
            continue  # trailing a statement
        if blocks and blocks[-1][1] == row - 1:
            start, _, directive = blocks[-1]
            blocks[-1] = (start, row, directive and _is_directive(tok.string))
            continue
        blocks.append((row, row, _is_directive(tok.string)))

    out: list[str] = []
    for start, end, directive in blocks:
        if directive:
            continue
        cap = header_lines if start == 1 else max_lines
        length = end - start + 1
        if length <= cap:
            continue
        out.append(
            f"{path}:{start}: comment block runs {length} lines; the cap is "
            f"{cap}. Keep the one non-obvious why, or drop it."
        )
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="check-comments.py", description=__doc__)
    p.add_argument("paths", nargs="+", type=Path)
    p.add_argument("--max", type=int, default=2, dest="max_lines")
    p.add_argument("--header", type=int, default=4, dest="header_lines")
    args = p.parse_args(argv)

    targets: list[Path] = []
    for target in args.paths:
        targets.extend(sorted(target.rglob("*.py")) if target.is_dir() else [target])

    found: list[str] = []
    for path in targets:
        if path.suffix == ".py" and path.exists():
            found.extend(
                violations(
                    path, max_lines=args.max_lines, header_lines=args.header_lines
                )
            )

    for line in found:
        print(line, file=sys.stderr)
    if found:
        print(f"\n{len(found)} over-long comment block(s).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
