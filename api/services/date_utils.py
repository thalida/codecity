"""Small date-string helpers shared across the scan/rollup code.

Dates flow through the manifest as ISO strings, which are lexically
comparable (earlier date → smaller string), so min/max reduce to a string
compare that also tolerates missing (None) operands.
"""

from __future__ import annotations


def min_iso(a: str | None, b: str | None) -> str | None:
    """Lexically-smaller (earliest) of two ISO date strings, ignoring None."""
    if a is None:
        return b
    if b is None:
        return a
    return a if a < b else b


def max_iso(a: str | None, b: str | None) -> str | None:
    """Lexically-larger (latest) of two ISO date strings, ignoring None."""
    if a is None:
        return b
    if b is None:
        return a
    return a if a > b else b
