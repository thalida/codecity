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
import re
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, NotRequired, TypedDict, cast

from api.config import CACHE_ROOT

if TYPE_CHECKING:
    from api.services.manifest_types import CommitEntry, Manifest, TimelineBundle


class FileEntry(TypedDict):
    """One entry in the per-root file-stat cache. (size, mtime) is the
    cache key; (lines, binary, ext) are the values warm scans skip
    recomputing. media_width/media_height are only present for
    recognized media files."""

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


class BlobEntry(TypedDict):
    """Content-addressed per-blob stats. Immutable: a git blob's sha
    fully determines its bytes, so an entry is never invalidated."""

    lines: int
    binary: bool
    media_width: NotRequired[int]
    media_height: NotRequired[int]


# CACHE_ROOT is imported from config (the single source of truth). The subdir
# helpers below derive manifests/files/git-history paths from it at call time,
# so a test monkeypatching cache.CACHE_ROOT cascades through.

# Cache-format versions: bump when the cached shape changes so stale blobs are
# treated as a miss and re-scanned. (Per-bump rationale lives in git history.)
_FILE_CACHE_VERSION = 1
_BLOB_STATS_CACHE_VERSION = 1  # blob_sha -> (lines, binary, media dims)
_GIT_HISTORY_CACHE_VERSION = 13  # v13: key generalized head_sha -> commit_sha (any ref)
_TIMELINE_CACHE_VERSION = 1  # bundle shape: commits/unionManifest/deltas/blobLines/note
_MANIFEST_SCHEMA_VERSION = (
    # v12: per-dir descendants_created_min / descendants_modified_max
    # v13: ext_breakdown `ext` is null (was "(none)") for extensionless files
    # v14: tree.name baked to the git remote's owner/repo at scan time
    # v15: sbom.json added to ALWAYS_SKIP
    # v16: FileNode.dirty + RepoStats.dirtyFileCount; dirty files use working-tree mtime
    # v17: layout_signature field; dirty in per-file signature
    # v18: Manifest/SignatureResponse field `signature` renamed `content_signature`
    #   (field rename is a shape change; old blobs lack the new key)
    18
)
# Composite: invalidates when EITHER the manifest schema OR the git-history
# shape changes. Stored as a string in the cache file's `version` field.
_MANIFEST_CACHE_VERSION: str = (
    f"m{_MANIFEST_SCHEMA_VERSION}-g{_GIT_HISTORY_CACHE_VERSION}"
)

# Full 40-char lowercase hex SHA; rejects corrupt/hand-edited sha fields.
_SHA_HEX_RE = re.compile(r"[0-9a-f]{40}")


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
    # Reject bool (which is a subclass of int in Python) to avoid corrupting dims.
    mw = d.get("media_width")
    mh = d.get("media_height")
    if (
        isinstance(mw, int)
        and isinstance(mh, int)
        and not isinstance(mw, bool)
        and not isinstance(mh, bool)
    ):
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
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    raw = cast(dict[str, object], parsed)
    if raw.get("version") != _FILE_CACHE_VERSION:
        return {}
    entries = raw.get("entries")
    if not isinstance(entries, dict):
        return {}
    result: dict[str, FileEntry] = {}
    # JSON object keys are always strings; values are validated by _coerce.
    for key, value in cast(dict[str, object], entries).items():
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


def _blob_cache_path(abs_root: Path) -> Path:
    return CACHE_ROOT / "blobs" / f"{repo_key(abs_root)}.json"


def cache_load_blobs(abs_root: Path) -> dict[str, "BlobEntry"]:
    """Load the per-repo blob-stats cache. {} on any error/version miss."""
    path = _blob_cache_path(abs_root)
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    raw = cast(dict[str, object], parsed)
    if raw.get("version") != _BLOB_STATS_CACHE_VERSION:
        return {}
    entries = raw.get("entries")
    if not isinstance(entries, dict):
        return {}
    out: dict[str, BlobEntry] = {}
    for sha, v in cast(dict[str, object], entries).items():
        if not isinstance(v, dict):
            continue
        d = cast(dict[str, object], v)
        lines, binary = d.get("lines"), d.get("binary")
        if not isinstance(lines, int) or isinstance(lines, bool):
            continue
        if not isinstance(binary, bool):
            continue
        entry: BlobEntry = {"lines": lines, "binary": binary}
        mw, mh = d.get("media_width"), d.get("media_height")
        if (
            isinstance(mw, int)
            and not isinstance(mw, bool)
            and isinstance(mh, int)
            and not isinstance(mh, bool)
        ):
            entry["media_width"], entry["media_height"] = mw, mh
        out[sha] = entry
    return out


def cache_save_blobs(abs_root: Path, entries: dict[str, "BlobEntry"]) -> None:
    """Union-merge write of the blob-stats cache (callers pass the merged
    dict). Atomic; swallows OSError on save, same as cache_save_manifest —
    a cache write failure must never break the response."""
    payload = {"version": _BLOB_STATS_CACHE_VERSION, "entries": entries}
    try:
        _atomic_write(_blob_cache_path(abs_root), json.dumps(payload))
    except OSError:
        pass


def _git_history_cache_path(abs_root: Path) -> Path:
    return CACHE_ROOT / "git-history" / f"{repo_key(abs_root)}.json"


def cache_load_git_history(
    abs_root: Path,
    commit_sha: str,
) -> tuple[dict[str, str], dict[str, str], list["CommitEntry"]] | None:
    """Load git-history maps + commits if cached for this root + commit.

    ``commit_sha`` may be HEAD or any other resolved ref sha.

    Returns None on miss or any error."""
    path = _git_history_cache_path(abs_root)
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    raw = cast(dict[str, object], parsed)
    if raw.get("version") != _GIT_HISTORY_CACHE_VERSION:
        return None
    if raw.get("commit_sha") != commit_sha:
        return None
    created_raw = raw.get("created")
    modified_raw = raw.get("modified")
    commits_raw = raw.get("commits")
    if (
        not isinstance(created_raw, dict)
        or not isinstance(modified_raw, dict)
        or not isinstance(commits_raw, list)
    ):
        return None
    # JSON object keys are always strings; keep only string values.
    created = {
        k: v
        for k, v in cast(dict[str, object], created_raw).items()
        if isinstance(v, str)
    }
    modified = {
        k: v
        for k, v in cast(dict[str, object], modified_raw).items()
        if isinstance(v, str)
    }
    commits: list["CommitEntry"] = []
    for c in cast(list[object], commits_raw):
        if not isinstance(c, dict):
            continue
        entry = cast(dict[str, object], c)
        date = entry.get("date")
        files = entry.get("files")
        sha = entry.get("sha")
        authors = entry.get("authors")
        subject = entry.get("subject")
        # Reconstruct the FULL CommitEntry — authors + subject are part of the
        # shape (v9/v11) and manifest consumers (fireflies iterate authors,
        # the commit pane shows subject) break without them. Drop any commit
        # missing/malformed on any field rather than emit a partial entry.
        if (
            isinstance(date, str)
            and isinstance(files, int)
            and not isinstance(files, bool)
            and isinstance(sha, str)
            and _SHA_HEX_RE.fullmatch(sha) is not None
            and isinstance(authors, list)
            and all(isinstance(a, str) for a in cast(list[object], authors))
            and isinstance(subject, str)
        ):
            commits.append(
                {
                    "date": date,
                    "files": files,
                    "sha": sha,
                    "authors": cast(list[str], authors),
                    "subject": subject,
                }
            )
    return created, modified, commits


def cache_save_git_history(
    abs_root: Path,
    commit_sha: str,
    created: dict[str, str],
    modified: dict[str, str],
    commits: list["CommitEntry"],
) -> None:
    """Atomically write the git-history cache for this root + commit."""
    payload = {
        "version": _GIT_HISTORY_CACHE_VERSION,
        "root": str(abs_root),
        "commit_sha": commit_sha,
        "created": created,
        "modified": modified,
        "commits": commits,
    }
    _atomic_write(_git_history_cache_path(abs_root), json.dumps(payload))


def _manifest_cache_path(abs_root: Path, content_signature: str) -> Path:
    return (
        CACHE_ROOT / "manifests" / f"{repo_key(abs_root)}__{content_signature}.json.gz"
    )


def _ref_manifest_cache_path(abs_root: Path, ref_sha: str) -> Path:
    # `__ref-` (not `__`) so cache_clear_manifests's `{repo_key}__*.json.gz`
    # glob still sweeps these alongside content-signature entries, while the
    # prefix keeps a ref-sha visually distinct from a content signature in
    # directory listings.
    return CACHE_ROOT / "manifests" / f"{repo_key(abs_root)}__ref-{ref_sha}.json.gz"


def _load_gz_envelope(
    path: Path, *, envelope_key: str, version: object
) -> dict[str, object] | None:
    """Load a gzip-envelope JSON cache file (``{"version", envelope_key:
    <dict>}``). Returns None on any error (missing file, gzip corruption,
    JSON parse, schema/version mismatch, or a non-dict payload). Shared body
    for every gzip-envelope cache (manifest, ref-manifest, timeline bundle) —
    same shape, same error hygiene: a corrupt cache is a miss, never a hard
    failure."""
    try:
        with gzip.open(path, "rb") as fh:
            raw = json.loads(fh.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    envelope = cast(dict[str, object], raw)
    if envelope.get("version") != version:
        return None
    payload = envelope.get(envelope_key)
    if not isinstance(payload, dict):
        return None
    return cast(dict[str, object], payload)


def _save_gz_envelope(
    path: Path, *, envelope_key: str, version: object, payload: dict[str, object]
) -> None:
    """Atomically write a gzip-envelope JSON cache file. Swallows OSError —
    cache save failures must never break the response. Shared body for every
    gzip-envelope cache."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps({"version": version, envelope_key: payload}).encode("utf-8")
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as fh:
            with gzip.GzipFile(fileobj=fh, mode="wb") as gz:
                gz.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except OSError:
        Path(tmp).unlink(missing_ok=True)


def _load_gz_manifest(path: Path) -> "Manifest | None":
    """Load a gzip-envelope manifest cache file. Shared body for both the
    content-signature and ref-keyed manifest caches."""
    manifest = _load_gz_envelope(
        path, envelope_key="manifest", version=_MANIFEST_CACHE_VERSION
    )
    # TypedDict is structurally compatible with dict at runtime; the
    # `Manifest` annotation is a documentation aid for callers.
    return manifest  # type: ignore[return-value]


def _save_gz_manifest(path: Path, manifest: "Manifest") -> None:
    """Atomically write a gzip-envelope manifest cache file. Shared body for
    both the content-signature and ref-keyed manifest caches."""
    _save_gz_envelope(
        path,
        envelope_key="manifest",
        version=_MANIFEST_CACHE_VERSION,
        payload=cast("dict[str, object]", manifest),
    )


def cache_load_manifest(
    abs_root: Path,
    content_signature: str,
) -> "Manifest | None":
    """Load the cached manifest for this (root, content_signature)."""
    return _load_gz_manifest(_manifest_cache_path(abs_root, content_signature))


def cache_save_manifest(
    abs_root: Path,
    content_signature: str,
    manifest: "Manifest",
) -> None:
    """Atomically write the manifest cache for this (root, content_signature)."""
    _save_gz_manifest(_manifest_cache_path(abs_root, content_signature), manifest)


def cache_load_ref_manifest(abs_root: Path, ref_sha: str) -> "Manifest | None":
    """Load the cached manifest for this (root, ref_sha). A resolved commit
    sha's manifest is immutable (the commit's content never changes), so
    unlike the content-signature cache this key never needs invalidating —
    only `cache_clear_manifests`/`cache_clear_all` remove it."""
    return _load_gz_manifest(_ref_manifest_cache_path(abs_root, ref_sha))


def cache_save_ref_manifest(abs_root: Path, ref_sha: str, manifest: "Manifest") -> None:
    """Atomically write the ref-keyed manifest cache for (root, ref_sha)."""
    _save_gz_manifest(_ref_manifest_cache_path(abs_root, ref_sha), manifest)


def _timeline_cache_path(abs_root: Path, head_sha: str) -> Path:
    # Lives alongside the manifest caches (same dir, same `__*.json.gz`
    # glob) so cache_clear_manifests/cache_clear_all sweep it too.
    return (
        CACHE_ROOT / "manifests" / f"{repo_key(abs_root)}__timeline-{head_sha}.json.gz"
    )


def cache_load_timeline(abs_root: Path, head_sha: str) -> "TimelineBundle | None":
    """Load the cached timeline bundle for this (root, head_sha). A bundle is
    immutable per HEAD (it replays fixed history), so unlike the content-
    signature manifest cache this key never needs invalidating — only
    `cache_clear_manifests`/`cache_clear_all` remove it."""
    bundle = _load_gz_envelope(
        _timeline_cache_path(abs_root, head_sha),
        envelope_key="bundle",
        version=_TIMELINE_CACHE_VERSION,
    )
    return bundle  # type: ignore[return-value]


def cache_save_timeline(
    abs_root: Path, head_sha: str, bundle: "TimelineBundle"
) -> None:
    """Atomically write the timeline bundle cache for (root, head_sha)."""
    _save_gz_envelope(
        _timeline_cache_path(abs_root, head_sha),
        envelope_key="bundle",
        version=_TIMELINE_CACHE_VERSION,
        payload=cast("dict[str, object]", bundle),
    )


def cache_clear_manifests(abs_root: Path) -> int:
    """Delete every cached manifest file for this root, across all
    signatures, every ref-keyed manifest, AND every timeline bundle (the
    `__*.json.gz` glob below matches `__<signature>.json.gz`,
    `__ref-<sha>.json.gz`, and `__timeline-<sha>.json.gz`).
    Returns the count deleted.

    Silently ignores I/O errors per the rest of this module's hygiene —
    cache cleanup failures must never break the response."""
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


def cache_clear_all(abs_root: Path) -> int:
    """Delete EVERY per-root cache for this root — manifest (all
    signatures), file-stat, git-history, and blob-stats. Returns the count
    deleted.

    Backs the "clear cache" flow's clean-slate guarantee for a source.
    The git clone working tree lives outside CACHE_ROOT, so the caller
    removes it separately (see clone.remove_clone). Same swallow-errors
    hygiene as the rest of this module — cleanup failures must never
    break the response."""
    count = cache_clear_manifests(abs_root)
    for path in (
        _file_cache_path(abs_root),
        _git_history_cache_path(abs_root),
        _blob_cache_path(abs_root),
    ):
        try:
            path.unlink()
            count += 1
        except OSError:
            pass  # missing file or I/O error — best-effort cleanup
    return count
