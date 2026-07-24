"""Timeline bundle: one git-history walk → per-commit blob deltas, replayed
client-side for smooth scrubbing. Read-only; reuses gitobj's git plumbing."""

from __future__ import annotations

import hashlib
import subprocess
import time
from pathlib import Path
from typing import Callable, NamedTuple

from .cache import BlobEntry, cache_load_blobs, cache_save_blobs
from .gitobj import _git_argv, blob_sizes_batch, blob_stats_batch
from .manifest_types import CommitEntry, FileNode, Manifest, TimelineBundle
from .media import media_kind
from .scan import (
    SCAN_PROGRESS_THROTTLE_S,
    NotAGitRepoError,
    _basename,
    _build_tree,
    build_file_node,
    _collect_git_history,
    _derive_tree_signals,
    _dir_children_from_paths,
    _extension,
    _hash_file_entry,
    _is_git_repo,
    _load_codecityignore,
    _log,
    _path_is_skipped,
    _reconstructed_repo_info,
    _wrap_manifest,
)

_UNION_FILE_CAP = 50000  # union files above this window to the most recent commits

# Progress payload shape: {"stage": "history", "commits": int} while walking
# git log, or {"stage": "blobs", "done": int, "total": int} while resolving
# blob tables. The router (api/routers/manifest.py) translates this into the
# wire-facing TimelineProgressEvent.
OnTimelineProgress = Callable[[dict[str, object]], None]

_HISTORY_HEARTBEAT_EVERY = 2000  # commits between progress ticks


class CommitDelta(NamedTuple):
    sha: str
    changes: list[tuple[str, str | None]]  # (path, new_blob_sha | None=delete)


def walk_deltas(
    root: Path,
    ref: str | None = None,
    *,
    on_progress: OnTimelineProgress | None = None,
) -> list[CommitDelta]:
    """Per-commit (path -> new blob sha, or None on delete), oldest-first.
    --no-abbrev keeps full 40-hex shas so blob lookups resolve; --no-renames
    records a rename as delete+add (matches the reconstruction semantics).
    ``on_progress`` gets a heartbeat every ``_HISTORY_HEARTBEAT_EVERY``
    commits (also time-throttled, for repos where git log outpaces that
    count), plus a final tick with the true total."""
    _log("walking commit history for timeline deltas…")
    argv = _git_argv(
        root,
        "log",
        "--format=COMMIT:%H",
        "--raw",
        "--no-abbrev",
        "--no-renames",
        # Merges undiffed (matches the scan walk): a subtree merge must not
        # re-add its files on the merge date.
    )
    if ref is not None:
        argv.append(ref)
    proc = subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    newest_first: list[CommitDelta] = []
    cur: CommitDelta | None = None
    commits = 0
    last_emit = 0.0
    assert proc.stdout is not None
    try:
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            if not line:
                continue
            if line.startswith("COMMIT:"):
                cur = CommitDelta(sha=line[len("COMMIT:") :], changes=[])
                newest_first.append(cur)
                commits += 1
                if commits % _HISTORY_HEARTBEAT_EVERY == 0:
                    _log(f"  walked {commits:,} commits…")
                    if on_progress is not None:
                        now = time.monotonic()
                        if now - last_emit >= SCAN_PROGRESS_THROTTLE_S:
                            on_progress({"stage": "history", "commits": commits})
                            last_emit = now
                continue
            if not line.startswith(":") or cur is None:
                continue
            # ":<mode> <mode> <sha_before> <sha_after> <status>\t<path>"
            meta, tab, path = line[1:].partition("\t")
            if not tab:
                continue
            parts = meta.split()
            if len(parts) < 5:
                continue
            mode_after, sha_after, status = parts[1], parts[3], parts[4]
            # Symlinks/submodules are excluded like the live scan; recording as a
            # deletion (not a drop) also pops any pre-typechange regular-file content.
            if mode_after in ("120000", "160000"):
                cur.changes.append((path, None))
                continue
            deleted = status.startswith("D") or sha_after.strip("0") == ""
            cur.changes.append((path, None if deleted else sha_after))
    finally:
        # kill before wait: a full stdout pipe would otherwise deadlock git
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    _log(f"  done — {commits:,} commits walked")
    if on_progress is not None:
        on_progress({"stage": "history", "commits": commits})  # final, unthrottled
    newest_first.reverse()
    return newest_first


def _collect_blob_tables(
    root: Path,
    deltas: list[CommitDelta],
    *,
    use_cache: bool = True,
    on_progress: OnTimelineProgress | None = None,
) -> tuple[dict[str, int], dict[str, int], dict[str, BlobEntry]]:
    """Resolve every touched blob's stats (lines, binary, binaryType, media dims)
    keyed by sha, plus a byte-size table. Stats go through the same content-
    addressed blob cache reconstruct_manifest uses (cat-file only the misses);
    sizes are a separate uncached batch. The blob-check batch resolves the total
    up front, so ``on_progress`` only needs a start + done tick."""
    shas = list({sha for d in deltas for _, sha in d.changes if sha})
    total = len(shas)
    media_shas = frozenset(
        sha
        for d in deltas
        for path, sha in d.changes
        if sha and media_kind(_extension(_basename(path)))
    )
    cached = cache_load_blobs(root) if use_cache else {}
    misses = [s for s in shas if s not in cached]
    _log(f"resolving {len(misses):,}/{total:,} blobs ({total - len(misses):,} cached)…")
    if on_progress is not None:
        on_progress({"stage": "blobs", "done": total - len(misses), "total": total})
    fresh = blob_stats_batch(root, misses, media_shas=media_shas) if misses else {}
    for sha, st in fresh.items():
        entry: BlobEntry = {"lines": st.lines, "binary": st.binary}
        if st.media_width is not None and st.media_height is not None:
            entry["media_width"], entry["media_height"] = (
                st.media_width,
                st.media_height,
            )
        if st.binary_type is not None:
            entry["binaryType"] = st.binary_type
        cached[sha] = entry
    if fresh:
        cache_save_blobs(root, cached)
    _log(f"  done — {total:,} blobs resolved")
    if on_progress is not None:
        on_progress({"stage": "blobs", "done": total, "total": total})
    lines = {s: cached[s]["lines"] for s in shas if s in cached}
    sizes = blob_sizes_batch(root, shas)
    blob_stats = {s: cached[s] for s in shas if s in cached}
    return lines, sizes, blob_stats


def build_union_manifest(
    root: Path,
    deltas: list[CommitDelta],
    blob_lines: dict[str, int],
    blob_sizes: dict[str, int],
    blob_stats: dict[str, BlobEntry],
    commits: list[CommitEntry],
    git_created: dict[str, str],
    git_modified: dict[str, str],
) -> Manifest:
    """City for the union of every path that ever existed. Each file's footprint
    `size` (and placeholder `lines`) is its MAX over history; binary/binaryType/
    media dims come from that largest-seen version's blob stats, so a binary file
    renders as a data building in Timeline exactly as it does live. created/
    modified come from the same full-ISO maps reconstruct_manifest uses. Flows
    through the SHARED tree builder + build_file_node so the layout matches every
    per-commit reconstruction it will be scrubbed against."""
    max_size: dict[str, int] = {}
    max_lines: dict[str, int] = {}
    # Stats of each path's largest-seen blob — the representative version whose
    # binary/media character the union node inherits (binary-ness is stable per
    # file, so any version's flag is fine; the largest keeps it consistent with
    # the footprint `size`).
    rep_stats: dict[str, BlobEntry] = {}
    for d in deltas:
        for path, sha in d.changes:
            if sha is None:
                continue
            size = blob_sizes.get(sha, 0)
            if path not in max_size or size >= max_size[path]:
                max_size[path] = size
                rep_stats[path] = blob_stats.get(sha, {"lines": 0, "binary": False})
            max_lines[path] = max(max_lines.get(path, 0), blob_lines.get(sha, 0))

    root_abs = str(Path(root).resolve())
    children_map = _dir_children_from_paths(max_size.keys())
    sig = hashlib.blake2b(digest_size=16)

    def list_children(rel_dir: str) -> list[tuple[str, str, bool]]:
        return children_map.get(rel_dir, [])

    def make_file_node(name: str, rel_path: str) -> FileNode:
        size = max_size.get(rel_path, 0)
        _hash_file_entry(sig, rel_path, size, 0.0, False)
        st = rep_stats.get(rel_path, {"lines": 0, "binary": False})
        return build_file_node(
            name=name,
            rel_path=rel_path,
            full_path=f"{root_abs}/{rel_path}",
            ext=_extension(name),
            size=size,
            lines=max_lines.get(rel_path, 0),
            binary=st["binary"],
            dirty=False,
            created=git_created.get(rel_path, ""),
            modified=git_modified.get(rel_path, ""),
            media_width=st.get("media_width"),
            media_height=st.get("media_height"),
            binary_type=st.get("binaryType"),
        )

    tree = _build_tree(
        root_abs, ".", list_children=list_children, make_file_node=make_file_node
    )
    signals = _derive_tree_signals(tree)
    head_sha = commits[-1]["sha"] if commits else ""
    repo_info = (
        _reconstructed_repo_info(Path(root_abs), head_sha)
        if head_sha
        else {
            "branch": None,
            "remote_url": None,
            "head_sha": None,
            "head_subject": None,
            "dirty": False,
        }
    )
    return _wrap_manifest(root_abs, tree, sig, signals, repo_info, commits)


def build_timeline_bundle(
    root: str,
    *,
    use_cache: bool = True,
    extra_exclude_paths: frozenset[str] = frozenset(),
    on_progress: OnTimelineProgress | None = None,
) -> TimelineBundle:
    """Assemble the full replay bundle: commits, the union manifest, per-commit
    blob deltas, and a sha -> line-count table. Pathological repos (union above
    `_UNION_FILE_CAP`) are windowed to their most recent commits, surfaced via
    `note`. ``extra_exclude_paths`` are the user's city excludes, folded into the
    same skip filter as .codecityignore so an excluded path is absent everywhere
    (union, deltas, blobs) — the timeline equivalent of the live scan's excludes.
    ``on_progress`` threads through to the history walk + blob resolution — see
    their docstrings for the payload shape."""
    root_path = Path(root).resolve()
    if not _is_git_repo(root_path):
        raise NotAGitRepoError(str(root_path))

    _log(f"building timeline bundle for {root_path}")
    deltas = walk_deltas(root_path, on_progress=on_progress)
    git_created, git_modified, commits = _collect_git_history(
        root_path, use_cache=use_cache
    )
    # same commit set + order across both walks, so index i lines up
    assert len(deltas) == len(commits), "delta/commit walks misaligned"

    # Apply the live scan's skip filter ONCE, upstream, so every downstream stage shares one filtered set.
    ignore_names, ignore_paths, unignore_names, unignore_paths = _load_codecityignore(
        root_path
    )
    if extra_exclude_paths:
        ignore_paths = ignore_paths | extra_exclude_paths
    deltas = [
        CommitDelta(
            sha=d.sha,
            changes=[
                (p, s)
                for p, s in d.changes
                if not _path_is_skipped(
                    p, ignore_names, ignore_paths, unignore_names, unignore_paths
                )
            ],
        )
        for d in deltas
    ]

    note = None
    union = {p for d in deltas for p, sha in d.changes if sha}
    if len(union) > _UNION_FILE_CAP:
        kept: set[str] = set()
        cut = len(deltas)
        for i in range(len(deltas) - 1, -1, -1):
            kept |= {p for p, sha in deltas[i].changes if sha}
            if len(kept) > _UNION_FILE_CAP:
                cut = i + 1
                break
        if deltas:
            cut = min(cut, len(deltas) - 1)  # always keep the most recent commit
        deltas = deltas[cut:]
        commits = commits[cut:]
        note = f"timeline covers the most recent {len(commits)} commits"

    blob_lines, blob_sizes, blob_stats = _collect_blob_tables(
        root_path, deltas, use_cache=use_cache, on_progress=on_progress
    )
    # Contract: every non-null delta sha needs a blobLines entry (default 0) so the client can't KeyError.
    for d in deltas:
        for _, sha in d.changes:
            if sha is not None:
                blob_lines.setdefault(sha, 0)
    union_manifest = build_union_manifest(
        root_path,
        deltas,
        blob_lines,
        blob_sizes,
        blob_stats,
        commits,
        git_created,
        git_modified,
    )
    _log("timeline bundle complete")

    return {
        "commits": commits,
        "unionManifest": union_manifest,
        "deltas": [
            {"sha": d.sha, "changes": [{"path": p, "sha": s} for p, s in d.changes]}
            for d in deltas
        ],
        "blobLines": blob_lines,
        "note": note,
    }
