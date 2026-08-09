"""Process configuration: env-driven flags and size limits.

Replaces the old api/env.py. Functions that read env are intentionally
LIVE (re-read per call) so tests can monkeypatch os.environ without a
restart — notably CODECITY_ALLOW_LOCAL_REPOS, which gates local scans.
"""

from __future__ import annotations

import os
from pathlib import Path

# Cap individual /api/file responses (stray symlink to a giant blob).
MAX_FILE_BYTES = 100 * 1024 * 1024
# Bodies under this skip gzip — framing overhead exceeds the savings.
GZIP_MIN_BYTES = 256
# Paths accepted per POST /api/images or /api/fingerprints; served over
# /api/config so the client chunks to the same number instead of guessing.
MAX_BATCH_PATHS = 64

# Root for every on-disk cache — the single source of truth for where codecity
# stores things. cache.py hangs its manifest/file-stat/git-history subdirs off
# this; clone.py its `clones/` dir. Read once at import (a fixed location, not a
# live flag); override with CODECITY_CACHE_ROOT (e.g. an XDG dir or a writable
# mount in containers). Tests monkeypatch the per-module copies.
CACHE_ROOT = Path(
    os.environ.get("CODECITY_CACHE_ROOT") or Path.home() / ".cache" / "codecity"
)

# Permissive truthy set (case-insensitive, trimmed) — matches the prior
# api/env.py semantics so e.g. `-e CODECITY_FOO=yes` keeps working.
_TRUTHY = frozenset({"1", "true", "yes", "on"})


def env_bool(name: str, default: bool = False) -> bool:
    """True if env var `name` is a truthy string (1/true/yes/on, any case)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY


# Discover ships on, so it needs the mirror of _TRUTHY: only an explicitly
# falsey value hides it. A truthy-set default would read `CODECITY_DISCOVER=
# enabled` as "off", silently emptying the landing's Discover tab.
_FALSEY = frozenset({"0", "false", "no", "off"})

DISCOVER_FILE = Path(__file__).parent / "discover.json"


def local_repos_allowed() -> bool:
    """Live read of CODECITY_ALLOW_LOCAL_REPOS (re-read per call)."""
    return env_bool("CODECITY_ALLOW_LOCAL_REPOS")


def hosted() -> bool:
    """Live read of CODECITY_HOSTED — set only in the deploy env.

    Distinct from `not local_repos_allowed()`: an unmounted local instance can
    enable local paths in ten seconds, a hosted one never can, and the two need
    different advice."""
    return env_bool("CODECITY_HOSTED")


def discover_enabled() -> bool:
    """Live read of CODECITY_DISCOVER — a disable flag, on unless set falsey."""
    raw = os.environ.get("CODECITY_DISCOVER")
    if raw is None:
        return True
    return raw.strip().lower() not in _FALSEY


def discover_file() -> Path:
    """Live read of CODECITY_DISCOVER_FILE — the curated Discover list."""
    raw = os.environ.get("CODECITY_DISCOVER_FILE")
    return Path(raw) if raw else DISCOVER_FILE


def quiet() -> bool:
    """Live read of CODECITY_QUIET — silences disconnect/scan logs."""
    return env_bool("CODECITY_QUIET")
