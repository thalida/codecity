"""Tree assembly and traversal.

The two filesystem touch-points are injected, so the live scan, the single-ref
reconstruction, and the timeline union all drive one frame/rollup/ordering
loop and therefore produce byte-identical structure and layout signatures."""

from __future__ import annotations

import os
from typing import Callable, Iterable, Iterator

from api.date_utils import max_iso, min_iso
from api.manifest_types import DirNode, ExtBreakdownEntry, FileNode, NodeKind
from api.media import media_kind

# ── Traversal ────────────────────────────────────────────────────────────────


def iter_file_nodes(node: DirNode) -> Iterator[FileNode]:
    """Every FileNode under `node`, depth-first."""
    for child in node["children"]:
        if child["type"] == NodeKind.FILE:
            yield child  # type: ignore[misc]
        else:
            yield from iter_file_nodes(child)  # type: ignore[arg-type]


def iter_dir_nodes(node: DirNode) -> Iterator[DirNode]:
    """Every descendant DirNode, NOT including `node` itself."""
    for child in node["children"]:
        if child["type"] == NodeKind.DIRECTORY:
            yield child  # type: ignore[misc]
            yield from iter_dir_nodes(child)  # type: ignore[arg-type]


# ── Nodes ────────────────────────────────────────────────────────────────────


def build_file_node(
    *,
    name: str,
    rel_path: str,
    full_path: str,
    ext: str,
    size: int,
    lines: int,
    binary: bool,
    dirty: bool,
    created: str,
    modified: str,
    media_width: int | None = None,
    media_height: int | None = None,
    binary_type: str | None = None,
) -> FileNode:
    """The one place a FileNode is assembled, so a new field is added once and
    no build path can silently omit it. Callers resolve the VALUES their own
    way (stat vs blob stats); this fixes the SHAPE."""
    node: FileNode = {
        "name": name,
        "type": NodeKind.FILE,
        "path": rel_path,
        "fullPath": full_path,
        "extension": ext,
        "mediaKind": media_kind(ext),
        "size": size,
        "lines": lines,
        "binary": binary,
        "dirty": dirty,
        "created": created,
        "modified": modified,
    }
    if media_width is not None and media_height is not None:
        node["media_width"] = media_width
        node["media_height"] = media_height
    if binary_type is not None:
        node["binaryType"] = binary_type
    return node


def apply_git_dates(
    node: DirNode | FileNode,
    git_created: dict[str, str],
    git_modified: dict[str, str],
) -> tuple[str | None, str | None]:
    """In-place: swap filesystem dates for history dates and refresh every
    directory rollup. Returns the subtree's (created_min, modified_max) so
    parents fold children in the same order build_tree does.

    A tracked-but-never-committed file keeps its fs date, and a dirty file
    keeps its working-tree mtime since its last-commit date is stale."""
    if node["type"] == NodeKind.FILE:
        rel_path = node["path"]
        node["created"] = git_created.get(rel_path) or node["created"]
        if not node["dirty"]:
            node["modified"] = git_modified.get(rel_path) or node["modified"]
        return node["created"], node["modified"]

    created_min: str | None = None
    modified_max: str | None = None
    for child in node["children"]:
        child_created, child_modified = apply_git_dates(
            child, git_created, git_modified
        )
        created_min = min_iso(created_min, child_created)
        modified_max = max_iso(modified_max, child_modified)
    node["descendants_created_min"] = created_min
    node["descendants_modified_max"] = modified_max
    return created_min, modified_max


def force_skeleton_placeholders(node: DirNode | FileNode) -> None:
    """In-place: uniform-height buildings for the skeleton emit."""
    if node["type"] == NodeKind.FILE:
        node["lines"] = 1  # type: ignore[typeddict-item]
        node["binary"] = False  # type: ignore[typeddict-item]
        return
    for child in node.get("children", []):  # type: ignore[union-attr]
        force_skeleton_placeholders(child)


# ── The walk ─────────────────────────────────────────────────────────────────

# (name, rel_path, is_dir) for one directory's children, in scandir order.
DirListing = list[tuple[str, str, bool]]


class _DirFrame:
    """One pending directory in the walk, accumulating its rollups."""

    __slots__ = (
        "rel_dir",
        "name",
        "full_path",
        "pending_entries",
        "next_entry",
        "files",
        "subdirs",
        "descendants_count",
        "descendants_file_count",
        "descendants_dir_count",
        "descendants_size",
        "descendants_created_min",
        "descendants_modified_max",
        "ext_breakdown",
    )

    def __init__(
        self,
        rel_dir: str,
        name: str,
        full_path: str,
        pending_entries: DirListing,
    ) -> None:
        self.rel_dir = rel_dir
        self.name = name
        self.full_path = full_path
        self.pending_entries = pending_entries
        # A cursor, not pop(0): popping the front shifts every remaining
        # element, making a wide directory O(entries²) to walk.
        self.next_entry = 0
        self.files: list[FileNode] = []
        self.subdirs: list[DirNode] = []
        self.descendants_count = 0
        self.descendants_file_count = 0
        self.descendants_dir_count = 0
        self.descendants_size = 0
        self.descendants_created_min: str | None = None
        self.descendants_modified_max: str | None = None
        # ext (lowercased, None when extensionless) -> [count, total_size]
        self.ext_breakdown: dict[str | None, list[int]] = {}

    def add_file(self, node: FileNode) -> None:
        self.files.append(node)
        self.descendants_count += 1
        self.descendants_file_count += 1
        self.descendants_size += node["size"]
        self.descendants_created_min = min_iso(
            self.descendants_created_min, node["created"]
        )
        self.descendants_modified_max = max_iso(
            self.descendants_modified_max, node["modified"]
        )
        raw_ext = node["extension"]
        self.add_ext(raw_ext.lower() if raw_ext else None, 1, node["size"])

    def add_ext(self, ext: str | None, count: int, size: int) -> None:
        bucket = self.ext_breakdown.get(ext)
        if bucket is None:
            self.ext_breakdown[ext] = [count, size]
        else:
            bucket[0] += count
            bucket[1] += size

    def absorb(self, child: DirNode) -> None:
        self.subdirs.append(child)
        self.descendants_count += 1 + child["descendants_count"]
        self.descendants_file_count += child["descendants_file_count"]
        self.descendants_dir_count += 1 + child["descendants_dir_count"]
        self.descendants_size += child["descendants_size"]
        self.descendants_created_min = min_iso(
            self.descendants_created_min, child["descendants_created_min"]
        )
        self.descendants_modified_max = max_iso(
            self.descendants_modified_max, child["descendants_modified_max"]
        )

    def finish(self) -> DirNode:
        children: list[FileNode | DirNode] = [*self.files, *self.subdirs]
        # Count desc, then ext asc; the extensionless bucket sorts last within
        # its count tier.
        ext_breakdown: list[ExtBreakdownEntry] = [
            {"ext": ext, "count": cnt, "size": size}
            for ext, (cnt, size) in sorted(
                self.ext_breakdown.items(),
                key=lambda kv: (-kv[1][0], kv[0] is None, kv[0] or ""),
            )
        ]
        return {
            "name": self.name,
            "type": NodeKind.DIRECTORY,
            "path": self.rel_dir,
            "fullPath": self.full_path,
            "children_count": len(children),
            "children_file_count": len(self.files),
            "children_dir_count": len(self.subdirs),
            "descendants_count": self.descendants_count,
            "descendants_file_count": self.descendants_file_count,
            "descendants_dir_count": self.descendants_dir_count,
            "descendants_size": self.descendants_size,
            "descendants_created_min": self.descendants_created_min,
            "descendants_modified_max": self.descendants_modified_max,
            "descendants_ext_breakdown": ext_breakdown,
            "children": children,
        }


def build_tree(
    root_abs: str,
    rel_root: str,
    *,
    list_children: Callable[[str], DirListing],
    make_file_node: Callable[[str, str], FileNode],
) -> DirNode:
    """DFS tree builder shared by every build path.

    - ``list_children(rel_dir)`` — sorted survivors of the skip/tracked filter;
      entries that are neither file nor dir are pre-filtered by the caller.
    - ``make_file_node(name, rel_path)`` — the leaf, plus whatever the caller
      wants to fold into its content hash and progress counter.

    Iterative because recursion blows the 1000-frame limit on deeply nested
    trees (Java package hierarchies, generated protobuf, monorepos).
    ``[*files, *subdirs]`` order and the ext sort are the contract the layout
    packer and the signatures depend on."""

    def frame(rel_dir: str, name: str) -> _DirFrame:
        full_path = root_abs if rel_dir == rel_root else f"{root_abs}/{rel_dir}"
        return _DirFrame(rel_dir, name, full_path, list_children(rel_dir))

    stack = [frame(rel_root, os.path.basename(root_abs))]

    while True:
        top = stack[-1]
        if top.next_entry < len(top.pending_entries):
            name, entry_rel, is_dir = top.pending_entries[top.next_entry]
            top.next_entry += 1
            if is_dir:
                stack.append(frame(entry_rel, name))  # rolled up when it pops
            else:
                top.add_file(make_file_node(name, entry_rel))
            continue

        finished = stack.pop()
        node_out = finished.finish()
        if not stack:
            return node_out
        parent = stack[-1]
        parent.absorb(node_out)
        for ext, (cnt, size) in finished.ext_breakdown.items():
            parent.add_ext(ext, cnt, size)


def dir_children_from_paths(paths: Iterable[str]) -> dict[str, DirListing]:
    """Flat path list → ``{rel_dir -> sorted children}``, materializing every
    intermediate directory. Sorted by name so build_tree's files-first split
    reproduces the live scandir order."""
    children: dict[str, set[tuple[str, str, bool]]] = {}
    for p in paths:
        parts = p.split("/")
        for i in range(len(parts)):
            parent = "." if i == 0 else "/".join(parts[:i])
            children.setdefault(parent, set()).add(
                (parts[i], "/".join(parts[: i + 1]), i < len(parts) - 1)
            )
    return {k: sorted(v, key=lambda t: t[0]) for k, v in children.items()}
