"""The manifest's three fingerprints.

- ``content_signature``   — paths + size + mtime + dirty; what the live-update
                            poll compares.
- ``structure_signature`` — paths + nesting only; gates the icon atlas.
- ``layout_signature``    — structure + per-file size, i.e. exactly the layout
                            packer's inputs, so the frontend reuses its packed
                            layout iff this is unchanged.

The full scan and the cheap signature endpoint push bytes through the SAME
helpers here — that's what lets the endpoint match a full scan exactly, so
drift here breaks live updates."""

from __future__ import annotations

import hashlib
from typing import Any, NamedTuple

from api.scan.filemeta import stat_fields
from api.manifest_types import DateRanges, DirNode, NodeKind, RepoInfo, TreeNode
from api.scan.skiprules import SkipRules, tracked_entries


def new_signature() -> Any:
    return hashlib.blake2b(digest_size=16)


def hash_file_entry(
    sig: Any, rel_path: str, size: int, mtime: float, is_dirty: bool
) -> None:
    sig.update(rel_path.encode("utf-8"))
    sig.update(b"\0")
    sig.update(str(size).encode("ascii"))
    sig.update(b"\0")
    sig.update(repr(mtime).encode("ascii"))
    sig.update(b"\0")
    # Dirty rides along: a mode-only edit flips it without moving size/mtime,
    # and a cached manifest would then serve a stale flag.
    sig.update(b"1" if is_dirty else b"0")
    sig.update(b"\0")


def hash_repo_info(sig: Any, repo_info: RepoInfo) -> None:
    """So the footer's "live" indicator catches a checkout or commit without
    waiting for file mtimes to shift."""
    sig.update(
        (
            f"{repo_info['branch']}|{repo_info['remote_url']}|"
            f"{repo_info['head_sha']}|{repo_info['dirty']}"
        ).encode("utf-8")
    )


def hash_tree(
    root_abs: str,
    *,
    tracked: set[str],
    dirty: set[str],
    rules: SkipRules,
    sig: Any,
) -> None:
    """Stat-only walk feeding the content signature without building nodes.

    Skips the content reads and per-file history — that's where the cost lives
    on a large repo — but mirrors build_tree's order exactly."""
    stack = [iter(tracked_entries(root_abs, ".", tracked=tracked, rules=rules))]
    while stack:
        for entry, entry_rel in stack[-1]:
            if entry.is_file(follow_symlinks=False):
                st = stat_fields(entry)
                hash_file_entry(sig, entry_rel, st.size, st.mtime, entry_rel in dirty)
            elif entry.is_dir(follow_symlinks=False):
                # Descend immediately so files and subdirs interleave in name
                # order, which is the order build_tree hashes them in.
                stack.append(
                    iter(
                        tracked_entries(
                            entry.path, entry_rel, tracked=tracked, rules=rules
                        )
                    )
                )
                break
        else:
            stack.pop()


class TreeSignals(NamedTuple):
    structure_signature: str
    layout_signature: str
    date_ranges: DateRanges


def derive_tree_signals(tree_root: DirNode) -> TreeSignals:
    """Both date-free signatures plus the repo-wide date range, in one pass.

    Every input is real in the pre-populate tree, so a scan's skeleton and
    final manifests agree. The layout hash prefixes each node with a type
    marker so a file's size token can't be misread as a sibling's path."""
    struct = hashlib.blake2b(digest_size=8)
    layout = hashlib.blake2b(digest_size=8)
    cmin = cmax = mmin = mmax = None

    def walk(node: TreeNode) -> None:
        nonlocal cmin, cmax, mmin, mmax
        struct.update(node["path"].encode("utf-8"))
        struct.update(b"\x00")
        layout.update(b"d" if node["type"] == NodeKind.DIRECTORY else b"f")
        layout.update(node["path"].encode("utf-8"))
        layout.update(b"\x00")
        if node["type"] == NodeKind.DIRECTORY:
            for c in sorted(node["children"], key=lambda n: n["path"]):
                walk(c)
        else:
            layout.update(str(node["size"]).encode("ascii"))
            layout.update(b"\x00")
            cr, md = node["created"], node["modified"]
            cmin = cr if cmin is None or cr < cmin else cmin
            cmax = cr if cmax is None or cr > cmax else cmax
            mmin = md if mmin is None or md < mmin else mmin
            mmax = md if mmax is None or md > mmax else mmax

    walk(tree_root)
    return TreeSignals(
        structure_signature=struct.hexdigest(),
        layout_signature=layout.hexdigest(),
        date_ranges={
            "minCreated": cmin,
            "maxCreated": cmax,
            "minModified": mmin,
            "maxModified": mmax,
        },
    )
