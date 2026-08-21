"""The manifests/ directory: built manifests, ref reconstructions, and timeline
bundles.

Three kinds of entry share one directory, one name shape and one retention
sweep, which is why they share a module. They differ only in what keys them:

    <sig>            a content signature — invalidated when the repo changes
    ref-<sha>        a resolved commit — immutable, never needs invalidating
    timeline-<sha>   a scrub bundle for that HEAD

Every one is a pure performance cache. Evicting costs a rescan, never
correctness, which is what lets retention be this blunt.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from api.cache.results.history import VERSION as HISTORY_VERSION
from api.cache.storage.paths import (
    KEY_SEP,
    ManifestFamily,
    entry_family,
    manifest_cache_path,
    manifest_dir,
    manifest_glob,
    ref_manifest_cache_path,
    repo_key,
    timeline_cache_path,
)
from api.cache.storage.retention import sweep_to_budget
from api.cache.storage.store import load_gz_envelope, save_gz_envelope
from api.models.manifest import Manifest, TimelineBundle

# Bump when a cached shape changes, so stale blobs miss and re-scan.
MANIFEST_SCHEMA_VERSION = 27
TIMELINE_VERSION = 8
# Composite: a manifest embeds history-derived dates, so it has to invalidate
# when EITHER the manifest schema or the git-history shape moves.
MANIFEST_VERSION: str = f"m{MANIFEST_SCHEMA_VERSION}-g{HISTORY_VERSION}"

# How many entries ONE repo keeps, so a burst in one family can't push out
# another's. Bytes are storage/retention.py's job: a count cannot bound them.
_KEEP = {
    # A signature dies the moment any tracked file is edited, so old ones are
    # near-worthless.
    ManifestFamily.CONTENT: 5,
    # A resolved commit is immutable, so these never go stale, and scrubbing
    # revisits them.
    ManifestFamily.REF: 20,
    # Immutable per (HEAD, excludes) like a ref, and the most expensive thing
    # here to rebuild — minutes, against seconds for anything else.
    ManifestFamily.TIMELINE: 10,
}


def drop_dead(path: Path) -> None:
    """Delete an entry that just failed to load.

    Every reason a load fails here is permanent for that file: a bumped version,
    a shape that no longer validates, bytes that no longer parse. Leaving it
    costs its size until the repo is scanned again, and repos that never are
    kept 385MB of unreadable entries on the machine this was measured on.
    """
    try:
        path.unlink()
    except OSError:
        pass  # already gone, or not ours to remove


def _load_manifest(path: Path) -> Manifest | None:
    """A manifest out of a gzip envelope, or None.

    A blob whose shape no longer validates is a miss, like a corrupt or
    version-mismatched one: handing a half-matching manifest to the renderer is
    worse than rescanning."""
    if not path.exists():
        return None
    payload = load_gz_envelope(path, envelope_key="manifest", version=MANIFEST_VERSION)
    if payload is not None:
        try:
            return Manifest.model_validate(payload)
        except ValidationError:
            pass
    drop_dead(path)
    return None


def _save_manifest(path: Path, manifest: Manifest) -> None:
    save_gz_envelope(
        path,
        envelope_key="manifest",
        version=MANIFEST_VERSION,
        payload=manifest.model_dump(),
    )


def prune_manifest_cache(abs_root: Path, *, protect: Path | None = None) -> int:
    """Sweep the cache after a save. Returns the count deleted.

    Two passes, because they bound different things: this root's per-family
    counts, then a byte budget over every repo's entries. The second is what
    reaches repos that are never scanned again, which the first cannot — it only
    ever runs against the root being saved.

    `protect` is never evicted by either: one-second mtime resolution lets a
    burst of saves tie, which could sort the just-written entry into the tail.
    Ordered by mtime, not atime (relatime doesn't track it), so a much-read old
    signature still ages out."""
    return _prune_families(abs_root, protect=protect) + sweep_to_budget(protect=protect)


def _prune_families(abs_root: Path, *, protect: Path | None = None) -> int:
    """Drop this root's oldest manifests/ entries, per family."""
    if not manifest_dir().exists():
        return 0

    prefix = f"{repo_key(abs_root)}{KEY_SEP}"
    families: dict[ManifestFamily, list[tuple[float, Path]]] = {
        family: [] for family in ManifestFamily
    }
    for path in manifest_dir().glob(manifest_glob(abs_root)):
        if protect is not None and path == protect:
            continue  # counts against nothing; it always stays
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue  # vanished under us; nothing to prune
        families[entry_family(path.name[len(prefix) :])].append((mtime, path))

    deleted = 0
    for family, entries in families.items():
        # The protected entry is out of `entries`, so leave room for it.
        keep = _KEEP[family]
        if protect is not None and entry_family(protect.name[len(prefix) :]) == family:
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


def cache_load_manifest(abs_root: Path, content_signature: str) -> Manifest | None:
    """The cached manifest for this (root, content_signature)."""
    return _load_manifest(manifest_cache_path(abs_root, content_signature))


def cache_load_newest_manifest(abs_root: Path) -> Manifest | None:
    """The most recently written CONTENT manifest for this root, whatever
    signature it was scanned at, or None if this root was never scanned.

    For the landing backdrop, which wants a city to show rather than a current
    one: staleness is invisible in wallpaper, and scanning to avoid it would
    cost a full walk on every cold boot."""
    prefix = f"{repo_key(abs_root)}{KEY_SEP}"
    newest: tuple[float, Path] | None = None
    for path in manifest_dir().glob(manifest_glob(abs_root)):
        if entry_family(path.name[len(prefix) :]) is not ManifestFamily.CONTENT:
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue  # vanished under us
        if newest is None or mtime > newest[0]:
            newest = (mtime, path)
    return _load_manifest(newest[1]) if newest else None


def cache_save_manifest(
    abs_root: Path, content_signature: str, manifest: Manifest
) -> None:
    """Atomically write the manifest cache for this (root, content_signature)."""
    path = manifest_cache_path(abs_root, content_signature)
    _save_manifest(path, manifest)
    prune_manifest_cache(abs_root, protect=path)


def cache_load_ref_manifest(abs_root: Path, ref_sha: str) -> Manifest | None:
    """The cached manifest for this (root, ref_sha). A resolved commit's content
    never changes, so unlike the content-signature cache this key never needs
    invalidating."""
    return _load_manifest(ref_manifest_cache_path(abs_root, ref_sha))


def cache_save_ref_manifest(abs_root: Path, ref_sha: str, manifest: Manifest) -> None:
    """Atomically write the ref-keyed manifest cache for (root, ref_sha)."""
    path = ref_manifest_cache_path(abs_root, ref_sha)
    _save_manifest(path, manifest)
    prune_manifest_cache(abs_root, protect=path)


def cache_load_timeline(
    abs_root: Path, head_sha: str, excludes: frozenset[str] = frozenset()
) -> TimelineBundle | None:
    """The cached bundle for (root, head_sha, excludes)."""
    path = timeline_cache_path(abs_root, head_sha, excludes)
    if not path.exists():
        return None
    payload = load_gz_envelope(path, envelope_key="bundle", version=TIMELINE_VERSION)
    if payload is not None:
        try:
            return TimelineBundle.model_validate(payload)
        except ValidationError:
            pass  # same treatment as a corrupt blob; see _load_manifest
    drop_dead(path)
    return None


def cache_save_timeline(
    abs_root: Path,
    head_sha: str,
    bundle: TimelineBundle,
    excludes: frozenset[str] = frozenset(),
) -> None:
    """Atomically write the bundle cache for (root, head_sha, excludes)."""
    path = timeline_cache_path(abs_root, head_sha, excludes)
    save_gz_envelope(
        path,
        envelope_key="bundle",
        version=TIMELINE_VERSION,
        payload=bundle.model_dump(),
    )
    prune_manifest_cache(abs_root, protect=path)


def cache_clear_timeline(abs_root: Path) -> int:
    """Delete every cached bundle for this root, across all HEADs, returning the
    count.

    A no_cache scan calls this: a bundle is immutable per HEAD, so nothing else
    would ever evict one built by older code."""
    if not manifest_dir().exists():
        return 0
    count = 0
    for path in manifest_dir().glob(
        manifest_glob(abs_root, f"{ManifestFamily.TIMELINE.tag}*")
    ):
        try:
            path.unlink()
            count += 1
        except OSError:
            pass
    return count
