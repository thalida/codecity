"""Where every cached thing lives on disk.

All of it hangs off CACHE_ROOT, and every path is built by a function rather
than bound to a constant, so a test that repoints CACHE_ROOT here redirects the
whole package rather than whichever module happened to import it first.

Layout under the root::

    files/<repo-key>.json          per-path stat cache
    blobs/<repo-key>.json          content-addressed blob stats
    git-history/<repo-key>.json    per-repo history walk
    manifests/<repo-key>__<name>.json.gz
    clones/                        owned by git/clone.py, not this package
"""

from __future__ import annotations

import hashlib
from enum import StrEnum
from pathlib import Path

from api.core.config import CACHE_ROOT

KEY_SEP = "__"  # between the repo key and the entry name
MANIFEST_EXT = ".json.gz"


class ManifestFamily(StrEnum):
    """Retention pool for a manifests/ entry. `tag` is how it reads on disk."""

    CONTENT = "content"
    REF = "ref"
    TIMELINE = "timeline"

    @property
    def tag(self) -> str:
        """Name prefix marking the family; content entries carry none."""
        return "" if self is ManifestFamily.CONTENT else f"{self.value}-"


def repo_key(abs_root: Path) -> str:
    """Stable short identifier for a repository's cache file. SHA-256 of the
    absolute path, first 16 hex chars."""
    return hashlib.sha256(str(abs_root).encode("utf-8")).hexdigest()[:16]


def file_cache_path(abs_root: Path) -> Path:
    return CACHE_ROOT / "files" / f"{repo_key(abs_root)}.json"


def blob_cache_path(abs_root: Path) -> Path:
    return CACHE_ROOT / "blobs" / f"{repo_key(abs_root)}.json"


def git_history_cache_path(abs_root: Path) -> Path:
    return CACHE_ROOT / "git-history" / f"{repo_key(abs_root)}.json"


def manifest_dir() -> Path:
    return CACHE_ROOT / "manifests"


def swept_dirs() -> list[Path]:
    """Every directory the retention sweep may delete from.

    clones/ is deliberately absent: git/clone.py owns it, a clone can be in use
    by a running scan, and removing one costs a re-clone rather than a re-read.
    """
    return [
        CACHE_ROOT / "files",
        CACHE_ROOT / "blobs",
        CACHE_ROOT / "git-history",
        manifest_dir(),
    ]


def manifest_path(abs_root: Path, name: str) -> Path:
    """One manifests/ entry for this root. Every writer goes through here so the
    name shape stays in lockstep with the glob below."""
    return manifest_dir() / f"{repo_key(abs_root)}{KEY_SEP}{name}{MANIFEST_EXT}"


def manifest_glob(abs_root: Path, name: str = "*") -> str:
    """Glob matching this root's manifests/ entries, optionally one family."""
    return f"{repo_key(abs_root)}{KEY_SEP}{name}{MANIFEST_EXT}"


def manifest_cache_path(abs_root: Path, content_signature: str) -> Path:
    return manifest_path(abs_root, content_signature)


def ref_manifest_cache_path(abs_root: Path, ref_sha: str) -> Path:
    # Tagged so a ref sha reads differently from a content signature in a listing.
    return manifest_path(abs_root, f"{ManifestFamily.REF.tag}{ref_sha}")


def _excludes_key(excludes: frozenset[str]) -> str:
    """Short stable digest of an exclude set for the cache filename. Order-free
    (sorted) so the same set always keys the same file."""
    return hashlib.sha256("\n".join(sorted(excludes)).encode("utf-8")).hexdigest()[:12]


def timeline_cache_path(
    abs_root: Path, head_sha: str, excludes: frozenset[str] = frozenset()
) -> Path:
    # Excludes reshape the filtered union, so they're part of the key; an empty
    # set keeps the bare head-sha name so existing caches stay valid.
    suffix = f"-{_excludes_key(excludes)}" if excludes else ""
    return manifest_path(abs_root, f"{ManifestFamily.TIMELINE.tag}{head_sha}{suffix}")


def entry_family(name: str) -> ManifestFamily:
    """Which retention pool an entry name (the part after the repo key) is in."""
    for family in (ManifestFamily.REF, ManifestFamily.TIMELINE):
        if name.startswith(family.tag):
            return family
    return ManifestFamily.CONTENT
