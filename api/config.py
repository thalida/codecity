"""Process configuration: env-driven flags and size limits.

Replaces the old api/env.py. Functions that read env are intentionally
LIVE (re-read per call) so tests can monkeypatch os.environ without a
restart — notably CODECITY_ALLOW_LOCAL_REPOS, which gates local scans.
"""
from __future__ import annotations

import os

# Cap individual /api/file responses (stray symlink to a giant blob).
MAX_FILE_BYTES = 100 * 1024 * 1024
# Bodies under this skip gzip — framing overhead exceeds the savings.
GZIP_MIN_BYTES = 256

# Permissive truthy set (case-insensitive, trimmed) — matches the prior
# api/env.py semantics so e.g. `-e CODECITY_FOO=yes` keeps working.
_TRUTHY = frozenset({"1", "true", "yes", "on"})


def env_bool(name: str, default: bool = False) -> bool:
    """True if env var `name` is a truthy string (1/true/yes/on, any case)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY


def local_repos_allowed() -> bool:
    """Live read of CODECITY_ALLOW_LOCAL_REPOS (re-read per call)."""
    return env_bool("CODECITY_ALLOW_LOCAL_REPOS")


def quiet() -> bool:
    """Live read of CODECITY_QUIET — silences disconnect/scan logs."""
    return env_bool("CODECITY_QUIET")
