"""Process configuration: typed CODECITY_* settings and size limits.

The api reads its configuration from the environment and nothing else. It does
NOT load .env.local: that file configures how you *launch* codecity (which
directory to mount, which flags to pass) and is read by bin/docker-args.py and
the justfile, which turn it into real env vars. Keeping the boundary there
means a test run can't pick up whatever happens to be in a developer's file.

Settings are read LIVE (a fresh Settings per accessor call) so tests can
monkeypatch os.environ without a restart, and so a flag applies on the next
request rather than the next restart.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Cap individual /api/file responses (stray symlink to a giant blob).
MAX_FILE_BYTES = 100 * 1024 * 1024
# Bodies under this skip gzip — framing overhead exceeds the savings.
GZIP_MIN_BYTES = 256
# Paths accepted per POST /api/images or /api/fingerprints; served over
# /api/config so the client chunks to the same number instead of guessing.
MAX_BATCH_PATHS = 64
# The batch is for many SMALL images: it inlines base64 into one JSON document,
# parsed atomically, so a big entry holds up every building batched with it.
MAX_BATCH_IMAGE_BYTES = 8 * 1024 * 1024
# Matches the renderer's tree cap (treePlacement.ts TREE_MAX_CELLS); beyond it
# the array is parsed only to be skipped. Aggregates still see every commit.
MAX_WIRE_COMMITS = 100_000

# parents[1] is the `api` package, not this module's core/ — the bundled list
# sits at api/discover.json, the path CODECITY_DISCOVER_FILE documents.
DISCOVER_FILE = Path(__file__).resolve().parents[1] / "discover.json"


class Settings(BaseSettings):
    """Every CODECITY_* env var, typed. Booleans accept 1/true/yes/on and
    0/false/no/off in any case; anything else raises rather than silently
    reading as the default."""

    model_config = SettingsConfigDict(env_prefix="CODECITY_", extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def _strip_whitespace(cls, data: Any) -> Any:
        """`CODECITY_QUIET=1 ` should not take the process down. Padding is
        easy to leave behind in a hand-edited file and never meaningful here."""
        if not isinstance(data, dict):
            return data
        raw = cast(dict[str, Any], data)
        return {k: v.strip() if isinstance(v, str) else v for k, v in raw.items()}

    # Gates local-path scans. Off by default: the api serves any root it's
    # been given, so filesystem access is opt-in.
    allow_local_repos: bool = False
    # Distinct from `not allow_local_repos`: an unmounted local instance can
    # enable local paths in ten seconds, a hosted one never can.
    hosted: bool = False
    # The landing's Discover tab, and the curated list behind it.
    discover: bool = True
    discover_file: Path = DISCOVER_FILE
    # Rendered behind the landing and flagged in Discover. Off by default: a
    # fresh install shouldn't clone anything for decoration nobody asked for.
    featured_repo: str = ""
    # Silences disconnect/scan logs.
    quiet: bool = False
    # Root for every on-disk cache. cache/paths.py hangs its subdirs off this,
    # git/clone.py its `clones/` dir.
    cache_root: Path = Path.home() / ".cache" / "codecity"
    # Ceiling for the derived caches under cache_root, swept oldest-first. Does
    # not cover clones/, which git/clone.py owns and which dwarfs the rest.
    cache_budget_mb: int = 1024


def settings() -> Settings:
    """A fresh read of the environment. Cheap: no file I/O, just os.environ."""
    return Settings()


# Read once at import (a fixed location, not a live flag) — e.g. an XDG dir or
# a writable mount in containers. Tests monkeypatch the per-module copies.
CACHE_ROOT = settings().cache_root
CACHE_BUDGET_BYTES = settings().cache_budget_mb * 1024 * 1024


def local_repos_allowed() -> bool:
    """Live read of CODECITY_ALLOW_LOCAL_REPOS (re-read per call)."""
    return settings().allow_local_repos


def hosted() -> bool:
    """Live read of CODECITY_HOSTED — set only in the deploy env."""
    return settings().hosted


def discover_enabled() -> bool:
    """Live read of CODECITY_DISCOVER."""
    return settings().discover


def discover_file() -> Path:
    """Live read of CODECITY_DISCOVER_FILE — the curated Discover list."""
    return settings().discover_file


def featured_repo() -> str:
    """Live read of CODECITY_FEATURED_REPO — the landing's backdrop city."""
    return settings().featured_repo.strip()


def quiet() -> bool:
    """Live read of CODECITY_QUIET — silences disconnect/scan logs."""
    return settings().quiet
