"""The curated barrels are boundaries, not suggestions.

`git/`, `scan/` and `cache/` each declare an `__all__` naming what the rest of
the api may use. That promise is only worth something if nothing reaches around
it: a package whose submodules are imported directly can't be reorganised
without touching its callers, which is exactly what the barrel exists to
prevent.

`git/` was in that state — routers went through the front door while scan/
imported `git.meta`, `git.objects` and `git.cmd` directly — so the docstring
claimed a contract the code didn't keep.

Tests are exempt. Reaching into internals is what a unit test is for.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

API = Path(__file__).resolve().parent.parent

# Packages whose __init__ curates an __all__ for outside callers.
GUARDED = ("git", "scan", "cache")


def _module_name(path: Path) -> str:
    parts = list(path.relative_to(API.parent).with_suffix("").parts)
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def _offences() -> list[str]:
    out: list[str] = []
    for path in sorted(API.rglob("*.py")):
        if "tests" in path.parts:
            continue
        module = _module_name(path)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            targets: list[str] = []
            if isinstance(node, ast.ImportFrom) and not node.level and node.module:
                targets.append(node.module)
            elif isinstance(node, ast.Import):
                targets.extend(a.name for a in node.names)
            for target in targets:
                bits = target.split(".")
                if len(bits) < 3 or bits[0] != "api" or bits[1] not in GUARDED:
                    continue
                # The package's own modules may import each other, and its
                # __init__ has to import them — that is what a barrel IS.
                if module == f"api.{bits[1]}" or module.startswith(f"api.{bits[1]}."):
                    continue
                out.append(
                    f"{path.relative_to(API.parent)}:{node.lineno} imports "
                    f"{target}; use `from api.{bits[1]} import ...`"
                )
    return out


class PackageBoundaryTests(unittest.TestCase):
    def test_nothing_reaches_past_a_barrel(self) -> None:
        offences = _offences()
        self.assertEqual(offences, [], "\n" + "\n".join(offences))

    def test_the_check_can_see_the_imports(self) -> None:
        """Guards the walk itself: if the AST scan stopped matching anything,
        the real test would pass by finding nothing rather than by there being
        nothing to find."""
        seen = sum(
            1
            for path in API.rglob("*.py")
            if "tests" not in path.parts
            and "from api.git import" in path.read_text(encoding="utf-8")
        )
        self.assertGreater(seen, 3, "expected several modules to use the git barrel")
