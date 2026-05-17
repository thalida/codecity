"""Persistent on-disk caches for the scanner.

Two caches with shared infrastructure:
  - Files: per-file (size, mtime) -> (lines, binary, ext) so warm
    re-scans skip _is_binary + _line_count for unchanged files.
  - Git history: per-repo HEAD-keyed (created_map, modified_map) so
    polling doesn't re-walk git log on every cycle.

Both caches store one file per scanned root in
~/.cache/codecity/{files,git-history}/<repo-key>.json. repo_key() is a
short SHA-256 of the absolute root path.

Invariants:
  - All loads return safe empty/None values on any error (corrupt JSON,
    version mismatch, missing file). Cache failures never block scans.
  - All writes are atomic (tempfile + rename) so an interrupted scan
    cannot corrupt the cache.
  - File-stat cache is union-merged on save by callers (entries the
    scan didn't visit are passed through unchanged). This module just
    persists whatever dict it's handed.
  - Git-history cache is overwritten on save (one HEAD per repo).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, NotRequired, TypedDict, cast

if TYPE_CHECKING:
    from codecity.types import Manifest

# Module-level CACHE_ROOT — tests monkeypatch this to a tempdir. Derived
# subdirs are computed at call time (not at import) so the override
# cascades through.
CACHE_ROOT = Path.home() / ".cache" / "codecity"

_FILE_CACHE_VERSION = 1
_GIT_HISTORY_CACHE_VERSION = 1


class FileEntry(TypedDict):
    # Required (always present in a valid entry):
    size: int
    mtime: float
    lines: int
    binary: bool
    ext: str
    # Optional — populated only for recognized media files. Either both
    # or neither is present; layout treats absence as "no signal" and
    # falls back to a square aspect.
    media_width: NotRequired[int]
    media_height: NotRequired[int]


def _coerce_file_entry(value: object) -> FileEntry | None:
    """Validate a parsed JSON value is a well-formed FileEntry. Returns
    the entry on success, None if any required field is missing or
    wrong-typed.

    Drops the entry rather than raising — a partially-corrupt cache
    file should yield only valid entries, not block the whole load."""
    if not isinstance(value, dict):
        return None
    d = cast(dict[str, object], value)
    try:
        size = d["size"]
        mtime = d["mtime"]
        lines = d["lines"]
        binary = d["binary"]
        ext = d["ext"]
    except KeyError:
        return None
    if not isinstance(size, int):
        return None
    if not isinstance(mtime, (int, float)):
        return None
    if not isinstance(lines, int):
        return None
    if not isinstance(binary, bool):
        return None
    if not isinstance(ext, str):
        return None
    entry: FileEntry = {
        "size": size,
        "mtime": float(mtime),
        "lines": lines,
        "binary": binary,
        "ext": ext,
    }
    # Optional media dims — both must be present and int-typed, else drop both.
    mw = d.get("media_width")
    mh = d.get("media_height")
    if isinstance(mw, int) and isinstance(mh, int):
        entry["media_width"] = mw
        entry["media_height"] = mh
    return entry


def repo_key(abs_root: Path) -> str:
    """Stable short identifier for a repository's cache file. SHA-256 of
    the absolute path, first 16 hex chars."""
    return hashlib.sha256(str(abs_root).encode("utf-8")).hexdigest()[:16]


def _atomic_write(path: Path, data: str) -> None:
    """Write `data` to `path` via tempfile + rename so a crashed write
    doesn't corrupt the existing file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def _file_cache_path(abs_root: Path) -> Path:
    return CACHE_ROOT / "files" / f"{repo_key(abs_root)}.json"


def cache_load_files(abs_root: Path) -> dict[str, FileEntry]:
    """Load the file-stat cache for this root. Returns {} on any error.

    Per-entry validation: malformed entries (missing fields, wrong
    types) are dropped silently. The cache is rebuildable from disk,
    so a partial load is preferable to a hard failure."""
    path = _file_cache_path(abs_root)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    if raw.get("version") != _FILE_CACHE_VERSION:
        return {}
    entries = raw.get("entries")
    if not isinstance(entries, dict):
        return {}
    result: dict[str, FileEntry] = {}
    for key, value in entries.items():
        if not isinstance(key, str):
            continue
        coerced = _coerce_file_entry(value)
        if coerced is not None:
            result[key] = coerced
    return result


def cache_save_files(abs_root: Path, entries: dict[str, FileEntry]) -> None:
    """Atomically write the file-stat cache for this root."""
    payload = {
        "version": _FILE_CACHE_VERSION,
        "root": str(abs_root),
        "entries": entries,
    }
    _atomic_write(_file_cache_path(abs_root), json.dumps(payload))


def _git_history_cache_path(abs_root: Path) -> Path:
    return CACHE_ROOT / "git-history" / f"{repo_key(abs_root)}.json"


def cache_load_git_history(
    abs_root: Path, head_sha: str,
) -> tuple[dict[str, str], dict[str, str]] | None:
    """Load git-history maps if cached for this root AND HEAD. Returns
    None on miss, HEAD mismatch, or any error.

    Per-entry validation: only string keys mapped to string values
    survive; everything else is dropped silently."""
    path = _git_history_cache_path(abs_root)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    if raw.get("version") != _GIT_HISTORY_CACHE_VERSION:
        return None
    if raw.get("head_sha") != head_sha:
        return None
    created_raw = raw.get("created")
    modified_raw = raw.get("modified")
    if not isinstance(created_raw, dict) or not isinstance(modified_raw, dict):
        return None
    created = {
        k: v for k, v in created_raw.items()
        if isinstance(k, str) and isinstance(v, str)
    }
    modified = {
        k: v for k, v in modified_raw.items()
        if isinstance(k, str) and isinstance(v, str)
    }
    return created, modified


def cache_save_git_history(
    abs_root: Path,
    head_sha: str,
    created: dict[str, str],
    modified: dict[str, str],
) -> None:
    """Atomically write the git-history cache for this root + HEAD."""
    payload = {
        "version": _GIT_HISTORY_CACHE_VERSION,
        "root": str(abs_root),
        "head_sha": head_sha,
        "created": created,
        "modified": modified,
    }
    _atomic_write(_git_history_cache_path(abs_root), json.dumps(payload))


_MANIFEST_CACHE_VERSION = 1


def _manifest_cache_path(abs_root: Path, signature: str) -> Path:
    return CACHE_ROOT / "manifests" / f"{repo_key(abs_root)}__{signature}.json.gz"


def cache_load_manifest(
    abs_root: Path, signature: str,
) -> "Manifest | None":
    """Load the cached manifest for this (root, signature). Returns
    None on any error (missing file, gzip corruption, JSON parse,
    schema/version mismatch). Same hygiene as the other cache loaders:
    a corrupt cache is treated as a miss, never a hard failure."""
    path = _manifest_cache_path(abs_root, signature)
    try:
        with gzip.open(path, "rb") as fh:
            raw = json.loads(fh.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    envelope = cast(dict[str, object], raw)
    if envelope.get("version") != _MANIFEST_CACHE_VERSION:
        return None
    manifest = envelope.get("manifest")
    if not isinstance(manifest, dict):
        return None
    # TypedDict is structurally compatible with dict at runtime; the
    # `Manifest` annotation is a documentation aid for callers.
    return manifest  # type: ignore[return-value]


def cache_save_manifest(
    abs_root: Path, signature: str, manifest: "Manifest",
) -> None:
    """Atomically write the manifest cache for this (root, signature).
    Swallows OSError — cache save failures must never break the
    response."""
    path = _manifest_cache_path(abs_root, signature)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({
        "version": _MANIFEST_CACHE_VERSION,
        "manifest": manifest,
    }).encode("utf-8")
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as fh:
            with gzip.GzipFile(fileobj=fh, mode="wb") as gz:
                gz.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except OSError:
        Path(tmp).unlink(missing_ok=True)


def cache_clear_manifests(abs_root: Path) -> int:
    """Delete every cached manifest file for this root, across all
    signatures. Returns the count deleted.

    Used by the frontend's "remove from recents" flow so a user who
    forgets a source also reclaims its cache. Silently ignores I/O
    errors per the rest of this module's hygiene — cache cleanup
    failures must never break the response."""
    manifests_dir = CACHE_ROOT / "manifests"
    if not manifests_dir.exists():
        return 0
    pattern = f"{repo_key(abs_root)}__*.json.gz"
    count = 0
    for path in manifests_dir.glob(pattern):
        try:
            path.unlink()
            count += 1
        except OSError:
            pass
    return count
