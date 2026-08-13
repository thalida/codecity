"""Persistent on-disk caches for the scanner.

Two caches with shared infrastructure:
  - Files: per-file (size, mtime) -> (lines, binary, ext) so warm
    re-scans skip is_binary + line_count for unchanged files.
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
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, NotRequired, TypedDict, cast

from api.config import CACHE_ROOT

KEY_SEP = "__"  # between the repo key and the entry name
MANIFEST_EXT = ".json.gz"

if TYPE_CHECKING:
    from api.git.objects import BlobStats
    from api.manifest_types import CommitEntry, Manifest, TimelineBundle


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
    # Optional — friendly magic-byte type, present only for recognized
    # binary files. Wire/node key (camelCase) reused as the cache key.
    binaryType: NotRequired[str]


class BlobEntry(TypedDict):
    """Content-addressed per-blob stats. Immutable: a git blob's sha
    fully determines its bytes, so an entry is never invalidated."""

    lines: int
    binary: bool
    size: NotRequired[int]  # real byte size (resolved for git-lfs, else blob size)
    media_width: NotRequired[int]
    media_height: NotRequired[int]
    binaryType: NotRequired[str]


def blob_entry(stats: "BlobStats") -> BlobEntry:
    """Freshly-read blob stats → a cache entry, dropping the fields that are
    absent rather than storing them as null."""
    entry: BlobEntry = {
        "lines": stats.lines,
        "binary": stats.binary,
        "size": stats.size,
    }
    if stats.media_width is not None and stats.media_height is not None:
        entry["media_width"] = stats.media_width
        entry["media_height"] = stats.media_height
    if stats.binary_type is not None:
        entry["binaryType"] = stats.binary_type
    return entry


# CACHE_ROOT is imported from config (the single source of truth). The subdir
# helpers below derive manifests/files/git-history paths from it at call time,
# so a test monkeypatching cache.CACHE_ROOT cascades through.

# Cache-format versions: bump when the cached shape changes so stale blobs are
# treated as a miss and re-scanned. (Per-bump rationale lives in git history.)
_FILE_CACHE_VERSION = 3  # v3: exact line counts (dropped the >5MB sampling estimate)
_BLOB_STATS_CACHE_VERSION = 4  # v4: git-lfs pointers resolved to real content
_GIT_HISTORY_CACHE_VERSION = 15  # v15: commit dates carry a time, not just a day
_TIMELINE_CACHE_VERSION = 7  # v7: bundle ships commitDateRanges
_MANIFEST_SCHEMA_VERSION = (
    # v12: per-dir descendants_created_min / descendants_modified_max
    # v13: ext_breakdown `ext` is null (was "(none)") for extensionless files
    # v14: tree.name baked to the git remote's owner/repo at scan time
    # v15: sbom.json added to ALWAYS_SKIP
    # v16: FileNode.dirty + RepoStats.dirtyFileCount; dirty files use working-tree mtime
    # v17: layout_signature field; dirty in per-file signature
    # v18: Manifest/SignatureResponse field `signature` renamed `content_signature`
    #   (field rename is a shape change; old blobs lack the new key)
    # v19: FileNode.binaryType + RepoStats.binaryCount/maxBinaryBytesFile/
    #   minBinaryBytesFile (binary files as a first-class "data" category)
    # v20: exact line counts (was sampled >5MB) — values change, bump to rebuild
    # v21: readmePath / readmeModified resolved server-side
    # v22: AuthorStat.hue resolved server-side
    # v23: Manifest.pending — which scan stages are still to come
    # v24: commits sampled above 100k; RepoStats.commitCount is the true total
    # v25: DirLeader.created/modified + RepoStats.oldestCreatedDir/newestCreatedDir
    25
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
    bt = d.get("binaryType")
    if isinstance(bt, str):
        entry["binaryType"] = bt
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
        sz = d.get("size")
        if isinstance(sz, int) and not isinstance(sz, bool):
            entry["size"] = sz
        mw, mh = d.get("media_width"), d.get("media_height")
        if (
            isinstance(mw, int)
            and not isinstance(mw, bool)
            and isinstance(mh, int)
            and not isinstance(mh, bool)
        ):
            entry["media_width"], entry["media_height"] = mw, mh
        bt = d.get("binaryType")
        if isinstance(bt, str):
            entry["binaryType"] = bt
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


class ManifestFamily(StrEnum):
    """Retention pool for a manifests/ entry. `tag` is how it reads on disk."""

    CONTENT = "content"
    REF = "ref"
    TIMELINE = "timeline"

    @property
    def tag(self) -> str:
        """Name prefix marking the family; content entries carry none."""
        return "" if self is ManifestFamily.CONTENT else f"{self.value}-"


def _manifest_dir() -> Path:
    """A function, not a constant, so a test patching CACHE_ROOT cascades."""
    return CACHE_ROOT / "manifests"


def _manifest_path(abs_root: Path, name: str) -> Path:
    """One manifests/ entry for this root. Every writer goes through here so the
    name shape stays in lockstep with the globs below."""
    return _manifest_dir() / f"{repo_key(abs_root)}{KEY_SEP}{name}{MANIFEST_EXT}"


def _manifest_glob(abs_root: Path, name: str = "*") -> str:
    """Glob matching this root's manifests/ entries, optionally one family."""
    return f"{repo_key(abs_root)}{KEY_SEP}{name}{MANIFEST_EXT}"


def _manifest_cache_path(abs_root: Path, content_signature: str) -> Path:
    return _manifest_path(abs_root, content_signature)


def _ref_manifest_cache_path(abs_root: Path, ref_sha: str) -> Path:
    # Tagged so a ref sha reads differently from a content signature in a listing.
    return _manifest_path(abs_root, f"{ManifestFamily.REF.tag}{ref_sha}")


def _load_gz_envelope(
    path: Path, *, envelope_key: str, version: object
) -> dict[str, object] | None:
    """Load a ``{"version", envelope_key: <dict>}`` gzip cache; None on any error (a corrupt cache is a miss)."""
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
    """Atomically write a ``{"version", envelope_key: <dict>}`` gzip cache; swallows OSError."""
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


# Keyed by repo CONTENT, so uncapped this grows for the life of the install.
# Pure performance caches: evicting costs a rescan, never correctness.
_KEEP_CONTENT_MANIFESTS = 5
_KEEP_REF_MANIFESTS = 20
_KEEP_TIMELINE_BUNDLES = 3


def _entry_family(name: str) -> ManifestFamily:
    """Which retention pool an entry name (the part after the repo key) is in."""
    for family in (ManifestFamily.REF, ManifestFamily.TIMELINE):
        if name.startswith(family.tag):
            return family
    return ManifestFamily.CONTENT


_FAMILY_KEEP = {
    ManifestFamily.CONTENT: _KEEP_CONTENT_MANIFESTS,
    ManifestFamily.REF: _KEEP_REF_MANIFESTS,
    ManifestFamily.TIMELINE: _KEEP_TIMELINE_BUNDLES,
}


def prune_manifest_cache(abs_root: Path, *, protect: Path | None = None) -> int:
    """Drop this root's oldest manifest-dir entries, per family. Returns the
    count deleted.

    `protect` is never evicted: one-second mtime resolution lets a burst of
    saves tie, which could sort the just-written entry into the tail.

    Ordered by mtime, not atime (relatime doesn't track it), so a much-read old
    signature still ages out. Best-effort, like the rest of this module."""
    if not _manifest_dir().exists():
        return 0

    prefix = f"{repo_key(abs_root)}{KEY_SEP}"
    families: dict[ManifestFamily, list[tuple[float, Path]]] = {
        family: [] for family in ManifestFamily
    }
    for path in _manifest_dir().glob(_manifest_glob(abs_root)):
        if protect is not None and path == protect:
            continue  # counts against nothing; it always stays
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue  # vanished under us; nothing to prune
        families[_entry_family(path.name[len(prefix) :])].append((mtime, path))

    deleted = 0
    for family, entries in families.items():
        # The protected entry is out of `entries`, so leave room for it.
        keep = _FAMILY_KEEP[family]
        if protect is not None and _entry_family(protect.name[len(prefix) :]) == family:
            keep -= 1
        if len(entries) <= keep:
            continue
        entries.sort(key=lambda e: e[0], reverse=True)  # newest first
        for _, path in entries[keep:]:
            try:
                path.unlink()
                deleted += 1
            except OSError:
                pass
    return deleted


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
    path = _manifest_cache_path(abs_root, content_signature)
    _save_gz_manifest(path, manifest)
    prune_manifest_cache(abs_root, protect=path)


def cache_load_ref_manifest(abs_root: Path, ref_sha: str) -> "Manifest | None":
    """Load the cached manifest for this (root, ref_sha). A resolved commit
    sha's manifest is immutable (the commit's content never changes), so
    unlike the content-signature cache this key never needs invalidating."""
    return _load_gz_manifest(_ref_manifest_cache_path(abs_root, ref_sha))


def cache_save_ref_manifest(abs_root: Path, ref_sha: str, manifest: "Manifest") -> None:
    """Atomically write the ref-keyed manifest cache for (root, ref_sha)."""
    path = _ref_manifest_cache_path(abs_root, ref_sha)
    _save_gz_manifest(path, manifest)
    prune_manifest_cache(abs_root, protect=path)


def _excludes_key(excludes: frozenset[str]) -> str:
    """Short stable digest of an exclude set for the cache filename. Order-free
    (sorted) so the same set always keys the same file."""
    return hashlib.sha256("\n".join(sorted(excludes)).encode("utf-8")).hexdigest()[:12]


def _timeline_cache_path(
    abs_root: Path, head_sha: str, excludes: frozenset[str] = frozenset()
) -> Path:
    # Excludes reshape the filtered union, so they're part of the key; an empty
    # set keeps the bare head-sha name so existing caches stay valid.
    suffix = f"-{_excludes_key(excludes)}" if excludes else ""
    return _manifest_path(abs_root, f"{ManifestFamily.TIMELINE.tag}{head_sha}{suffix}")


def cache_load_timeline(
    abs_root: Path, head_sha: str, excludes: frozenset[str] = frozenset()
) -> "TimelineBundle | None":
    """Cached bundle for (root, head_sha, excludes); immutable per key, cleared only by cache_clear_*."""
    bundle = _load_gz_envelope(
        _timeline_cache_path(abs_root, head_sha, excludes),
        envelope_key="bundle",
        version=_TIMELINE_CACHE_VERSION,
    )
    return bundle  # type: ignore[return-value]


def cache_save_timeline(
    abs_root: Path,
    head_sha: str,
    bundle: "TimelineBundle",
    excludes: frozenset[str] = frozenset(),
) -> None:
    """Atomically write the timeline bundle cache for (root, head_sha, excludes)."""
    path = _timeline_cache_path(abs_root, head_sha, excludes)
    _save_gz_envelope(
        path,
        envelope_key="bundle",
        version=_TIMELINE_CACHE_VERSION,
        payload=cast("dict[str, object]", bundle),
    )
    prune_manifest_cache(abs_root, protect=path)


def cache_clear_timeline(abs_root: Path) -> int:
    """Delete every cached timeline bundle for this root (all HEADs). Returns
    the count deleted. A no_cache scan calls this so re-entering Timeline mode
    rebuilds fresh — the bundle is immutable per HEAD, so nothing else evicts a
    stale one built by older code. Same swallow-errors hygiene as the rest of
    this module."""
    if not _manifest_dir().exists():
        return 0
    count = 0
    for path in _manifest_dir().glob(
        _manifest_glob(abs_root, f"{ManifestFamily.TIMELINE.tag}*")
    ):
        try:
            path.unlink()
            count += 1
        except OSError:
            pass
    return count
