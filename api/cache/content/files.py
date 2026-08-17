"""The per-path file-stat cache.

Keyed by (size, mtime), so a warm re-scan skips the binary sniff and the line
count for every file that hasn't moved. Union-merged on save by the caller:
entries this scan didn't visit pass through untouched, which is what keeps a
`.codecityignore` edit from throwing away everything it hid.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from api.cache.content.entries import FileEntry, coerce_file_entry
from api.cache.storage.paths import file_cache_path
from api.cache.storage.store import atomic_write, load_json

VERSION = 3


def cache_load_files(abs_root: Path) -> dict[str, FileEntry]:
    """The file-stat cache for this root, or {} on any error.

    Malformed entries are dropped one by one: the cache is rebuildable from
    disk, so a partial load beats a hard failure."""
    raw = load_json(file_cache_path(abs_root), version=VERSION)
    if raw is None:
        return {}
    entries = raw.get("entries")
    if not isinstance(entries, dict):
        return {}
    result: dict[str, FileEntry] = {}
    # JSON object keys are always strings; the values are what need checking.
    for key, value in cast(dict[str, object], entries).items():
        coerced = coerce_file_entry(value)
        if coerced is not None:
            result[key] = coerced
    return result


def cache_save_files(abs_root: Path, entries: dict[str, FileEntry]) -> None:
    """Atomically write the file-stat cache for this root."""
    payload = {"version": VERSION, "root": str(abs_root), "entries": entries}
    atomic_write(file_cache_path(abs_root), json.dumps(payload))
