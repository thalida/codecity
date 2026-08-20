"""Per-file facts read from git blobs — the counterpart to filemeta's reads off
the filesystem.

Both git-sourced build paths, the ref reconstruction and the timeline's union,
resolve blob stats through the same content-addressed cache and assemble their
leaves identically. They disagree on one thing only: which version of a path
they describe, a single blob or the largest over all of history. That is the
`size`/`lines` pair each caller passes; everything else is shared.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Iterable

from api.cache import BlobEntry, blob_entry, cache_load_blobs, cache_save_blobs
from api.git import blob_stats_batch
from api.models.manifest import FileNode
from api.scan.filemeta import FileMeta, basename, extension
from api.scan.signatures import hash_file_entry
from api.scan.treebuild import build_file_node
from api.core.progress import log
from api.utils.media import media_kind

# A blob absent from the stats table still has to render: unknown reads as an
# empty text file rather than dropping the node out of the tree.
MISSING_BLOB: BlobEntry = {"lines": 0, "binary": False}


def resolve_blob_stats(
    root: Path,
    wanted: Iterable[tuple[str, str]],
    *,
    use_cache: bool = True,
    on_resolved: Callable[[int, int], None] | None = None,
) -> dict[str, BlobEntry]:
    """Stats for every (sha, path) in `wanted`, keyed by sha.

    The path decides only whether the media probe runs: hachoir throws its whole
    format battery at whatever it is handed, so it is held to extensions that
    claim to be media. Cache hits cost nothing, misses are cat-filed in one
    batch and written back, and `on_resolved` gets (done, total) as they land.

    Only the requested shas come back, though the whole merged table is what
    gets saved — the timeline ships its result over the wire, and returning the
    full cache would put every blob the repo has ever had in the payload.
    """
    pairs = list(wanted)
    shas = list({sha for sha, _ in pairs})
    media_shas = frozenset(
        sha for sha, path in pairs if media_kind(extension(basename(path)))
    )

    cached = cache_load_blobs(root) if use_cache else {}
    misses = [sha for sha in shas if sha not in cached]
    hits = len(shas) - len(misses)
    log(f"resolving {len(misses):,}/{len(shas):,} blobs ({hits:,} cached)…")
    if on_resolved is not None:
        on_resolved(hits, len(shas))

    fresh = (
        blob_stats_batch(
            root,
            misses,
            media_shas=media_shas,
            on_progress=(
                None
                if on_resolved is None
                else lambda n: on_resolved(hits + n, len(shas))
            ),
        )
        if misses
        else {}
    )
    for sha, stats in fresh.items():
        cached[sha] = blob_entry(stats)
    if fresh:
        cache_save_blobs(root, cached)
    log(f"  done — {len(shas):,} blobs resolved")
    return {sha: cached[sha] for sha in shas if sha in cached}


def blob_file_node(
    sig: Any,
    *,
    name: str,
    rel_path: str,
    root_abs: str,
    size: int | None,
    lines: int | None,
    stats: BlobEntry,
    created: str,
    modified: str,
) -> FileNode:
    """A leaf for a git-sourced tree, plus the signature entry that goes with it.

    mtime 0.0 and dirty False: a commit has neither. `size` and `lines` are the
    caller's call, one blob's or the largest over history, while binary and the
    media trio always come from `stats` through the one reader.
    """
    hash_file_entry(sig, rel_path, size, 0.0, False)
    meta = FileMeta.from_cache(stats)
    return build_file_node(
        name=name,
        rel_path=rel_path,
        full_path=f"{root_abs}/{rel_path}",
        ext=extension(name),
        size=size,
        lines=lines,
        binary=meta.binary,
        dirty=False,
        created=created,
        modified=modified,
        media_width=meta.media_width,
        media_height=meta.media_height,
        binary_type=meta.binary_type,
    )
