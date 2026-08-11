"""Per-file facts read from the filesystem: name parsing, stat fields, line
counts, binary detection, and the batched content read that fills a built
tree's placeholder metadata."""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple

from api.binfmt import detect_binary_type
from api.cache import BlobEntry, FileEntry, cache_load_files, cache_save_files
from api.git.objects import BINARY_CHUNK, is_binary_bytes
from api.manifest_types import DirNode, FileNode
from api.media import probe_media_dims
from api.progress import log
from api.errors import ScanCancelledError, check_cancel
from api.scan.treebuild import iter_file_nodes

# ── Names ────────────────────────────────────────────────────────────────────


def basename(rel_path: str) -> str:
    return rel_path.rsplit("/", 1)[-1]


def extension(name: str) -> str:
    """Suffix after the last dot, including the dot. A dotfile only has one if
    a second dot follows the leading one."""
    if "." not in name:
        return ""
    if name.startswith(".") and "." not in name[1:]:
        return ""
    return "." + name.rsplit(".", 1)[-1]


# ── Stat + content ───────────────────────────────────────────────────────────


def epoch_to_iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class StatFields(NamedTuple):
    size: int
    created: str
    modified: str
    mtime: float  # raw, for the content hash and the cache key


def stat_fields(entry: os.DirEntry[str]) -> StatFields:
    st = entry.stat()
    birth = getattr(st, "st_birthtime", st.st_ctime)  # macOS only; else ctime
    return StatFields(
        st.st_size, epoch_to_iso(birth), epoch_to_iso(st.st_mtime), st.st_mtime
    )


# is_binary and line_count delegate to / mirror gitobj so a file classifies and
# counts identically live and in a past-commit reconstruction.
def is_binary(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            chunk = fh.read(BINARY_CHUNK)
    except OSError:
        return True
    return is_binary_bytes(chunk)


def line_count(path: Path) -> int:
    try:
        total = 0
        last_byte = b""
        with path.open("rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                total += chunk.count(b"\n")
                last_byte = chunk[-1:]
        if last_byte and last_byte != b"\n":
            total += 1
        return total
    except OSError:
        return 0


def _binary_type(path: Path) -> str | None:
    try:
        with path.open("rb") as fh:
            head = fh.read(64)  # every magic-byte signature fits
    except OSError:
        return None
    return detect_binary_type(head)


class FileMeta(NamedTuple):
    """The content-derived half of a FileNode.

    One definition of which fields are optional, shared by the cache read, the
    cache write, and the node write — each used to hand-roll the same
    media-dims/binaryType dance, and a missed field once left binaries
    un-rendered."""

    binary: bool
    lines: int
    media_width: int | None = None
    media_height: int | None = None
    binary_type: str | None = None

    @classmethod
    def read(cls, path: Path) -> "FileMeta":
        binary = is_binary(path)
        width, height = probe_media_dims(path)
        return cls(
            binary=binary,
            lines=0 if binary else line_count(path),
            media_width=width,
            media_height=height,
            binary_type=_binary_type(path) if binary else None,
        )

    @classmethod
    def from_cache(cls, entry: FileEntry | BlobEntry) -> "FileMeta":
        """Both caches store the same optional-field shape, so one reader
        serves the live scan (keyed by path) and the ref reconstruction
        (keyed by blob sha)."""
        return cls(
            binary=entry["binary"],
            lines=entry["lines"],
            media_width=entry.get("media_width"),
            media_height=entry.get("media_height"),
            binary_type=entry.get("binaryType"),
        )

    def apply_to(self, node: FileNode) -> None:
        """Overwrite placeholder metadata in place. Media dims are written only
        as a pair, so a node never carries half of one."""
        node["binary"] = self.binary
        node["lines"] = self.lines
        if self.media_width is not None and self.media_height is not None:
            node["media_width"] = self.media_width
            node["media_height"] = self.media_height
        if self.binary_type is not None:
            node["binaryType"] = self.binary_type


def _cache_entry(node: FileNode, mtime: float) -> FileEntry:
    entry: FileEntry = {
        "size": node["size"],
        "mtime": mtime,
        "lines": node["lines"],
        "binary": node["binary"],
        "ext": node["extension"],
    }
    if "media_width" in node and "media_height" in node:
        entry["media_width"] = node["media_width"]
        entry["media_height"] = node["media_height"]
    if "binaryType" in node:
        entry["binaryType"] = node["binaryType"]
    return entry


def _node_mtime(node: FileNode) -> float:
    """The node's `modified` is a lossy ISO string; the cache keys on the raw
    float, so re-stat for it."""
    try:
        return Path(node["fullPath"]).stat().st_mtime
    except OSError:
        return 0.0


# Oversubscribed (2x cores) because the workers block on read(); capped so a
# high-core machine doesn't pay pool-construction overhead for nothing.
_POOL_SIZE = min(32, (os.cpu_count() or 1) * 2)


def populate_file_metadata(
    tree: DirNode,
    abs_root: Path,
    *,
    use_cache: bool,
    cancel_event: threading.Event | None = None,
) -> None:
    """Fill in `lines`, `binary`, and media dims on every FileNode. Cache hits
    resolve inline; misses are read in parallel."""
    nodes: list[FileNode] = list(iter_file_nodes(tree))
    if not nodes:
        return

    cache_entries: dict[str, FileEntry] = (
        cache_load_files(abs_root) if use_cache else {}
    )
    mtimes = [_node_mtime(node) for node in nodes]

    misses: list[int] = []
    for i, node in enumerate(nodes):
        cached = cache_entries.get(node["path"]) if use_cache else None
        if (
            cached is not None
            and cached["size"] == node["size"]
            and cached["mtime"] == mtimes[i]
        ):
            FileMeta.from_cache(cached).apply_to(node)
        else:
            misses.append(i)

    log(
        f"  populating metadata: {len(nodes)} files "
        f"({len(nodes) - len(misses)} cache hits, {len(misses)} to read)"
    )
    if misses:
        _read_misses(nodes, misses, cancel_event)

    # Always write: use_cache gates only the READ. Warm scans union-merge onto
    # the loaded cache, preserving entries for files this scan didn't visit
    # (e.g. when .codecityignore flips).
    for node, mtime in zip(nodes, mtimes):
        cache_entries[node["path"]] = _cache_entry(node, mtime)
    try:
        cache_save_files(abs_root, cache_entries)
    except OSError:
        pass


def _read_misses(
    nodes: list[FileNode],
    misses: list[int],
    cancel_event: threading.Event | None,
) -> None:
    # A fresh clone reads every file here — 10s+ of silence on a large repo
    # without the heartbeat.
    heartbeat_step = max(200, len(misses) // 20)
    done = 0
    with ThreadPoolExecutor(max_workers=_POOL_SIZE) as pool:
        future_to_idx = {
            pool.submit(FileMeta.read, Path(nodes[i]["fullPath"])): i for i in misses
        }
        try:
            for fut in as_completed(future_to_idx):
                if cancel_event is not None and cancel_event.is_set():
                    for f in future_to_idx:
                        f.cancel()
                    check_cancel(cancel_event)
                fut.result().apply_to(nodes[future_to_idx[fut]])
                done += 1
                if done % heartbeat_step == 0:
                    log(f"    read {done}/{len(misses)} files…")
        except ScanCancelledError:
            pool.shutdown(wait=False)
            raise
    log(f"    read {len(misses)}/{len(misses)} files")
