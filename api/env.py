"""Permissive boolean env-var parsing.

Single helper shared by every codecity env-driven bool. Truthy values
(case-insensitive, whitespace-trimmed): "1", "true", "yes", "on".
Anything else — including unset, "", "0", "false", "no", "off" — is
False (or the supplied default for unset).

Matches the convention used by Docker / Django / typical CLI tooling
so users setting ``-e CODECITY_FOO=true`` aren't surprised by silent
failure.
"""

from __future__ import annotations

import os

_TRUTHY = frozenset({"1", "true", "yes", "on"})


def env_bool(name: str, default: bool = False) -> bool:
    """Read env var ``name`` as a permissive boolean.

    Returns ``default`` if the variable is unset. For any set value,
    returns True only when the trimmed lower-case value is in the
    truthy set above.
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY
