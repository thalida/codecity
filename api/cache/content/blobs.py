"""The content-addressed blob-stats cache.

Keyed by blob sha, so entries never go stale: a sha fully determines its bytes.
That is what lets the timeline resolve a whole history's blobs by cat-filing
only the ones it has never seen.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from api.cache.content.entries import BlobEntry, coerce_blob_entry
from api.cache.storage.paths import blob_cache_path
from api.cache.storage.store import atomic_write, load_json

VERSION = 4


def cache_load_blobs(abs_root: Path) -> dict[str, BlobEntry]:
    """The per-repo blob-stats cache; {} on any error or version miss."""
    raw = load_json(blob_cache_path(abs_root), version=VERSION)
    if raw is None:
        return {}
    entries = raw.get("entries")
    if not isinstance(entries, dict):
        return {}
    out: dict[str, BlobEntry] = {}
    for sha, value in cast(dict[str, object], entries).items():
        coerced = coerce_blob_entry(value)
        if coerced is not None:
            out[sha] = coerced
    return out


def cache_save_blobs(abs_root: Path, entries: dict[str, BlobEntry]) -> None:
    """Union-merge write (the caller passes the merged dict). Swallows OSError:
    a failed cache write must never break the response it rode along with."""
    payload = {"version": VERSION, "entries": entries}
    try:
        atomic_write(blob_cache_path(abs_root), json.dumps(payload))
    except OSError:
        pass
