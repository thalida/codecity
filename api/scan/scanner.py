"""CodeCity's scanner entry points.

- ``scan_tree``            — the live working tree, streamed as three manifests.
- ``signature_tree``       — the same fingerprint, without building anything.
- ``reconstruct_manifest`` — the tree AS OF a past ref, read-only.

Only tracked files are scanned: parents of tracked files are walked, but
unstaged additions and gitignored paths are skipped. Progress goes to stderr;
silence it with CODECITY_QUIET=1."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Callable, Iterator, NamedTuple

from api.core.constants import ScanEvent
from api.git import objects as gitobj
from api.cache import BlobEntry, blob_entry, cache_load_blobs, cache_save_blobs
from api.scan.filemeta import (
    FileMeta,
    basename,
    extension,
    populate_file_metadata,
    stat_fields,
)
from api.git.meta import (
    GitState,
    collect_git_history,
    collect_git_state,
    is_git_repo,
    reconstructed_repo_info,
)
from api.scan.manifest import utc_now_iso, wrap_manifest
from api.models.manifest import (
    DirNode,
    FileNode,
    Manifest,
    SignatureResponse,
)
from api.utils.media import media_kind
from api.core.progress import Heartbeat, log
from api.core.exceptions import NotAGitRepoError, check_cancel
from api.scan.signatures import (
    derive_tree_signals,
    hash_file_entry,
    hash_repo_info,
    hash_tree,
    new_signature,
)
from api.scan.skiprules import SkipRules, tracked_entries
from api.scan.treebuild import (
    DirListing,
    apply_git_dates,
    build_file_node,
    build_tree,
    dir_children_from_paths,
    force_skeleton_placeholders,
)


class ScanStreamEvent(NamedTuple):
    """One manifest emission from scan_tree.

    `phase` separates the early "manifest-partial" emission (real structure,
    placeholder metadata) from "manifest-complete". Internal to the scan ->
    router handoff, so a NamedTuple rather than a wire model: the router reads
    `phase` to name the SSE event and serialises `manifest` on its own."""

    phase: ScanEvent
    manifest: Manifest


def _resolved_git_root(root: str) -> tuple[str, Path]:
    root_abs = str(Path(root).resolve())
    root_path = Path(root_abs)
    if not is_git_repo(root_path):
        raise NotAGitRepoError(root_abs)
    return root_abs, root_path


class LiveTreeSource:
    """The live-filesystem half of a scan: which entries exist, and how a leaf
    becomes a node. Everything build_tree needs that touches the disk.

    A named seam rather than closures inside scan_tree so a test can drive
    build_tree with the real adapters instead of reimplementing them."""

    def __init__(
        self,
        root_abs: str,
        git: GitState,
        rules: SkipRules,
        sig: Any,
        heartbeat: Heartbeat | None = None,
    ) -> None:
        self.root_abs = root_abs
        self.git = git
        self.rules = rules
        self.sig = sig
        self.heartbeat = heartbeat
        # scandir entries are threaded from the listing to the node builder so
        # the stat happens once, on the real DirEntry.
        self._entries: dict[str, os.DirEntry[str]] = {}

    def list_children(self, rel_dir: str) -> DirListing:
        abs_dir = self.root_abs if rel_dir == "." else f"{self.root_abs}/{rel_dir}"
        out: DirListing = []
        for entry, entry_rel in tracked_entries(
            abs_dir, rel_dir, tracked=self.git.tracked, rules=self.rules
        ):
            is_dir = entry.is_dir(follow_symlinks=False)
            # Anything that's neither (dangling symlink, socket, fifo) is
            # dropped here, so is_dir alone drives the loop.
            if not is_dir and not entry.is_file(follow_symlinks=False):
                continue
            if not is_dir:
                self._entries[entry_rel] = entry
            out.append((entry.name, entry_rel, is_dir))
        return out

    def make_file_node(self, name: str, rel_path: str) -> FileNode:
        """A skeleton node: lines/binary are placeholders that
        populate_file_metadata fills in, and the dates are the filesystem's
        until apply_git_dates overlays history."""
        entry = self._entries.pop(rel_path)
        st = stat_fields(entry)
        is_dirty = rel_path in self.git.dirty
        hash_file_entry(self.sig, rel_path, st.size, st.mtime, is_dirty)
        if self.heartbeat is not None:
            self.heartbeat.tick()
        return build_file_node(
            name=name,
            rel_path=rel_path,
            full_path=entry.path,
            ext=extension(name),
            size=st.size,
            lines=0,
            binary=False,
            dirty=is_dirty,
            created=st.created,
            modified=st.modified,
        )

    def build(self) -> DirNode:
        return build_tree(
            self.root_abs,
            ".",
            list_children=self.list_children,
            make_file_node=self.make_file_node,
        )


def scan_tree(
    root: str,
    *,
    use_cache: bool = True,
    cancel_event: threading.Event | None = None,
    on_scan_progress: Callable[[int], None] | None = None,
    extra_exclude_paths: frozenset[str] = frozenset(),
) -> Iterator[ScanStreamEvent]:
    """Scan a git working tree, yielding a manifest per stage.

    The stages are ordered by what unblocks the UI soonest: the skeleton (real
    structure, placeholder heights) so it can paint and pack a layout, then
    per-file metadata for real building heights, then history last — by far the
    longest stage, and only decorations and the timeline read it."""
    root_abs, root_path = _resolved_git_root(root)
    log(f"resolving {root_abs}")
    check_cancel(cancel_event)

    git = collect_git_state(root_path)
    heartbeat = Heartbeat(on_progress=on_scan_progress)
    sig = new_signature()

    log("walking tree…")
    tree = LiveTreeSource(
        root_abs,
        git,
        SkipRules.load(root_path, extra_exclude_paths=extra_exclude_paths),
        sig,
        heartbeat,
    ).build()
    heartbeat.flush()
    log(f"walked {heartbeat.seen} files; emitting skeleton")

    # Derived from the real pre-populate metadata (no mtime), so the skeleton
    # and final manifests of one scan carry identical signatures.
    signals = derive_tree_signals(tree)
    check_cancel(cancel_event)

    # Deep-copied so the skeleton's placeholder mutation doesn't touch the tree
    # populate_file_metadata is about to modify. ~50ms on linux.
    skeleton = tree.model_copy(deep=True)
    force_skeleton_placeholders(skeleton)
    # No commits: they're ~89% of the payload and the skeleton draws none of them.
    yield ScanStreamEvent(
        phase=ScanEvent.MANIFEST_PARTIAL,
        manifest=wrap_manifest(
            root_abs, skeleton, sig, signals, git.repo, [], ["metadata", "history"]
        ),
    )

    check_cancel(cancel_event)
    log("resolving file metadata")
    populate_file_metadata(
        tree, root_path, use_cache=use_cache, cancel_event=cancel_event
    )
    check_cancel(cancel_event)
    log("emitting metadata manifest")
    yield ScanStreamEvent(
        phase=ScanEvent.MANIFEST_PARTIAL,
        manifest=wrap_manifest(
            root_abs,
            tree.model_copy(deep=True),
            sig,
            signals,
            git.repo,
            [],
            ["history"],
        ),
    )

    check_cancel(cancel_event)
    log("collecting git metadata…")
    history = collect_git_history(root_path, use_cache=use_cache)
    apply_git_dates(tree, history.created, history.modified)
    # Re-derived so the date range reflects history. Both signatures are
    # date-free, so they come back identical and the frontend keeps its layout.
    signals = derive_tree_signals(tree)
    hash_repo_info(sig, git.repo)

    check_cancel(cancel_event)
    log("emitting final manifest")
    yield ScanStreamEvent(
        phase=ScanEvent.MANIFEST_COMPLETE,
        manifest=wrap_manifest(
            root_abs, tree, sig, signals, git.repo, history.commits, []
        ),
    )


def signature_tree(
    root: str,
    *,
    use_cache: bool = True,
    extra_exclude_paths: frozenset[str] = frozenset(),
) -> SignatureResponse:
    """scan_tree's content_signature without the manifest.

    ``use_cache`` is accepted for API symmetry with scan_tree (both endpoints
    take the same query params) but is a no-op: nothing here is cacheable."""
    root_abs, root_path = _resolved_git_root(root)
    git = collect_git_state(root_path)
    sig = new_signature()
    hash_tree(
        root_abs,
        tracked=git.tracked,
        dirty=git.dirty,
        rules=SkipRules.load(root_path, extra_exclude_paths=extra_exclude_paths),
        sig=sig,
    )
    hash_repo_info(sig, git.repo)
    return SignatureResponse(
        root=root_abs,
        scanned_at=utc_now_iso(),
        content_signature=sig.hexdigest(),
    )


def reconstruct_manifest(root: str, ref: str, *, use_cache: bool = True) -> Manifest:
    """The manifest AS OF ``ref``, from ls-tree + cat-file only — the working
    tree is never checked out or written.

    Shares build_tree with the live scan, so structure and layout signatures
    match a live scan of the same tree. content_signature does NOT: the live
    hash folds in real mtimes, which a ref has none of. Harmless, because a ref
    manifest is cached by sha rather than by content_signature.

    Raises ValueError for a ref that doesn't resolve to a commit."""
    root_abs, root_path = _resolved_git_root(root)
    commit_sha = gitobj.resolve_ref(root_path, ref)
    if commit_sha is None:
        raise ValueError(f"ref does not resolve to a commit: {ref!r}")

    # .codecityignore is read from the CURRENT working copy so the filter
    # doesn't jump around as the ref moves.
    rules = SkipRules.load(root_path)
    blobs = [
        b
        for b in gitobj.ls_tree_files(root_path, commit_sha)
        if not rules.skips_path(b.path)
    ]
    by_path = {b.path: b for b in blobs}

    # Content-addressed blob cache first, cat-file only the misses. Media dims
    # are probed only for media extensions, keeping hachoir off source blobs.
    cached = cache_load_blobs(root_path) if use_cache else {}
    media_shas = frozenset(
        b.sha for b in blobs if media_kind(extension(basename(b.path)))
    )
    misses = [b.sha for b in blobs if b.sha not in cached]
    fresh = (
        gitobj.blob_stats_batch(root_path, misses, media_shas=media_shas)
        if misses
        else {}
    )
    for sha, stats in fresh.items():
        cached[sha] = blob_entry(stats)
    if fresh:
        cache_save_blobs(root_path, cached)

    history = collect_git_history(root_path, use_cache=use_cache, ref=commit_sha)
    children_map = dir_children_from_paths(by_path.keys())
    sig = new_signature()

    def make_file_node(name: str, rel_path: str) -> FileNode:
        blob = by_path[rel_path]
        entry: BlobEntry = cached.get(blob.sha, {"lines": 0, "binary": False})
        meta = FileMeta.from_cache(entry)
        # mtime 0.0 and dirty False: a committed ref has neither.
        hash_file_entry(sig, rel_path, blob.size, 0.0, False)
        return build_file_node(
            name=name,
            rel_path=rel_path,
            full_path=f"{root_abs}/{rel_path}",
            ext=extension(name),
            size=blob.size,
            lines=meta.lines,
            binary=meta.binary,
            dirty=False,
            created=history.created.get(rel_path, ""),
            modified=history.modified.get(rel_path, ""),
            media_width=meta.media_width,
            media_height=meta.media_height,
            binary_type=meta.binary_type,
        )

    tree = build_tree(
        root_abs,
        ".",
        list_children=lambda rel_dir: children_map.get(rel_dir, []),
        make_file_node=make_file_node,
    )
    return wrap_manifest(
        root_abs,
        tree,
        sig,
        derive_tree_signals(tree),
        reconstructed_repo_info(root_path, commit_sha),
        history.commits,
        [],
    )
