"""Timeline bundle: one git-history walk → per-commit blob deltas, replayed
client-side for smooth scrubbing. Read-only; reuses gitobj's git plumbing."""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import NamedTuple

from .cache import BlobEntry, cache_load_blobs, cache_save_blobs
from .gitobj import _git_argv, blob_sizes_batch, blob_stats_batch
from .manifest_types import CommitEntry, FileNode, Manifest, NodeKind, TimelineBundle
from .media import media_kind
from .scan import (
    NotAGitRepoError,
    _basename,
    _build_tree,
    _collect_git_history,
    _derive_tree_signals,
    _dir_children_from_paths,
    _extension,
    _hash_file_entry,
    _is_git_repo,
    _load_codecityignore,
    _path_is_skipped,
    _reconstructed_repo_info,
    _wrap_manifest,
)

_UNION_FILE_CAP = 20000  # union files above this window to the most recent commits


class CommitDelta(NamedTuple):
    sha: str
    changes: list[tuple[str, str | None]]  # (path, new_blob_sha | None=delete)


def walk_deltas(root: Path, ref: str | None = None) -> list[CommitDelta]:
    """Per-commit (path -> new blob sha, or None on delete), oldest-first.
    --no-abbrev keeps full 40-hex shas so blob lookups resolve; --no-renames
    records a rename as delete+add (matches the reconstruction semantics)."""
    argv = _git_argv(
        root,
        "log",
        "--format=COMMIT:%H",
        "--raw",
        "--no-abbrev",
        "--no-renames",
        "--diff-merges=first-parent",
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
    assert proc.stdout is not None
    try:
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            if not line:
                continue
            if line.startswith("COMMIT:"):
                cur = CommitDelta(sha=line[len("COMMIT:") :], changes=[])
                newest_first.append(cur)
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
            # Drop symlink (120000) / gitlink-submodule (160000) adds+mods, as the
            # live scan does; a deletion (mode_after 000000) is left as a no-op.
            if mode_after in ("120000", "160000"):
                continue
            deleted = status.startswith("D") or sha_after.strip("0") == ""
            cur.changes.append((path, None if deleted else sha_after))
    finally:
        # kill before wait: a full stdout pipe would otherwise deadlock git
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    newest_first.reverse()
    return newest_first


def _collect_blob_tables(
    root: Path, deltas: list[CommitDelta], *, use_cache: bool = True
) -> tuple[dict[str, int], dict[str, int]]:
    """Resolve every touched blob's (lines, byte size) keyed by sha. Lines go
    through the same content-addressed blob cache reconstruct_manifest uses
    (cat-file only the misses); sizes are a separate uncached batch."""
    shas = list({sha for d in deltas for _, sha in d.changes if sha})
    media_shas = frozenset(
        sha
        for d in deltas
        for path, sha in d.changes
        if sha and media_kind(_extension(_basename(path)))
    )
    cached = cache_load_blobs(root) if use_cache else {}
    misses = [s for s in shas if s not in cached]
    fresh = blob_stats_batch(root, misses, media_shas=media_shas) if misses else {}
    for sha, st in fresh.items():
        entry: BlobEntry = {"lines": st.lines, "binary": st.binary}
        if st.media_width is not None and st.media_height is not None:
            entry["media_width"], entry["media_height"] = (
                st.media_width,
                st.media_height,
            )
        cached[sha] = entry
    if fresh:
        cache_save_blobs(root, cached)
    lines = {s: cached[s]["lines"] for s in shas if s in cached}
    sizes = blob_sizes_batch(root, shas)
    return lines, sizes


def build_union_manifest(
    root: Path,
    deltas: list[CommitDelta],
    blob_lines: dict[str, int],
    blob_sizes: dict[str, int],
    commits: list[CommitEntry],
    git_created: dict[str, str],
    git_modified: dict[str, str],
) -> Manifest:
    """City for the union of every path that ever existed. Each file's
    footprint `size` (and placeholder `lines`) is its MAX over history.
    created/modified come from the same full-ISO maps `reconstruct_manifest`
    uses (not day-precision commit dates), so precision matches everywhere
    else in the app. Flows through the SHARED tree builder so the layout
    matches every per-commit reconstruction it will be scrubbed against."""
    max_size: dict[str, int] = {}
    max_lines: dict[str, int] = {}
    for d in deltas:
        for path, sha in d.changes:
            if sha is None:
                continue
            max_size[path] = max(max_size.get(path, 0), blob_sizes.get(sha, 0))
            max_lines[path] = max(max_lines.get(path, 0), blob_lines.get(sha, 0))

    root_abs = str(Path(root).resolve())
    children_map = _dir_children_from_paths(max_size.keys())
    sig = hashlib.blake2b(digest_size=16)

    def list_children(rel_dir: str) -> list[tuple[str, str, bool]]:
        return children_map.get(rel_dir, [])

    def make_file_node(name: str, rel_path: str) -> FileNode:
        size = max_size.get(rel_path, 0)
        _hash_file_entry(sig, rel_path, size, 0.0, False)
        ext = _extension(name)
        return {
            "name": name,
            "type": NodeKind.FILE,
            "path": rel_path,
            "fullPath": f"{root_abs}/{rel_path}",
            "extension": ext,
            "mediaKind": media_kind(ext),
            "size": size,
            "lines": max_lines.get(rel_path, 0),
            "binary": False,
            "dirty": False,
            "created": git_created.get(rel_path, ""),
            "modified": git_modified.get(rel_path, ""),
        }

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


def build_timeline_bundle(root: str, *, use_cache: bool = True) -> TimelineBundle:
    """Assemble the full replay bundle: commits, the union manifest, per-commit
    blob deltas, and a sha -> line-count table. Pathological repos (union above
    `_UNION_FILE_CAP`) are windowed to their most recent commits, surfaced via
    `note`."""
    root_path = Path(root).resolve()
    if not _is_git_repo(root_path):
        raise NotAGitRepoError(str(root_path))

    deltas = walk_deltas(root_path)
    git_created, git_modified, commits = _collect_git_history(
        root_path, use_cache=use_cache
    )
    # both walks enumerate the same first-parent history in the same order
    assert len(deltas) == len(commits), "delta/commit walks misaligned"

    # Apply the live scan's path skip filter ONCE, upstream, so the union
    # manifest + deltas + blobLines all share the identical filtered file set.
    ignore_names, ignore_paths, unignore_names, unignore_paths = _load_codecityignore(
        root_path
    )
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

    blob_lines, blob_sizes = _collect_blob_tables(
        root_path, deltas, use_cache=use_cache
    )
    # Contract: every non-null delta sha must have a blobLines entry so the
    # client can't KeyError; an unresolvable sha defaults to 0.
    for d in deltas:
        for _, sha in d.changes:
            if sha is not None:
                blob_lines.setdefault(sha, 0)
    union_manifest = build_union_manifest(
        root_path, deltas, blob_lines, blob_sizes, commits, git_created, git_modified
    )

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
