#!/usr/bin/env python3
"""scan.py — CodeCity filesystem scanner.

Walks a directory tree, collects file/directory metadata + git history
(created/modified dates only), and emits a nested JSON manifest.

Invoked by the server's /api/manifest handler, or directly as a CLI:

    python3 scan.py --root <path>

Outputs manifest JSON on stdout; progress on stderr. Silence progress
with CODECITY_QUIET=1.

In a git repo, only tracked files are scanned (parents of tracked files
are walked but unstaged additions and gitignored paths are skipped).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .cache import (
    FileEntry,
    cache_load_files,
    cache_load_git_history,
    cache_save_files,
    cache_save_git_history,
)
from .media_dims import probe_media_dims
from .types import (
    DirNode,
    FileNode,
    GitMeta,
    Manifest,
    NodeKind,
    RepoInfo,
    ScanStreamEvent,
    SignatureResponse,
)


class ScanCancelledError(Exception):
    """Raised when a scan_tree_streaming cancel_event is set mid-scan.

    Caller (the server's _serve_manifest) is expected to swallow this
    — it means 'the client disconnected, we asked the scan to stop,
    it stopped.' Not a bug, not an error to report to anyone."""


def _check_cancel(event: "threading.Event | None") -> None:
    """Raise ScanCancelledError if the cancellation event is set.

    Cheap; called at every phase boundary in scan_tree_streaming and
    between batches in _populate_file_metadata."""
    if event is not None and event.is_set():
        raise ScanCancelledError()


# ── Progress logging ─────────────────────────────────────────────────────────


def _log(msg: str) -> None:
    if os.environ.get("CODECITY_QUIET") != "1":
        print(f"[scan] {msg}", file=sys.stderr, flush=True)


# ── Binary detection ─────────────────────────────────────────────────────────

_BINARY_CHUNK_SIZE = 8192
# Bytes that are suspicious for text files. Control chars below 0x20
# except whitespace + null are usually binary indicators.
_TEXT_CHARACTERS = bytes({7, 8, 9, 10, 11, 12, 13, 27}) + bytes(range(0x20, 0x100))


def _is_binary(path: Path) -> bool:
    """Null-byte / non-text-char heuristic. Fast, no subprocess."""
    try:
        with path.open("rb") as fh:
            chunk = fh.read(_BINARY_CHUNK_SIZE)
    except OSError:
        return True
    if not chunk:
        return False
    if b"\x00" in chunk:
        return True
    # If >30% of bytes are outside the "text" set, call it binary.
    non_text = sum(1 for b in chunk if b not in _TEXT_CHARACTERS)
    return non_text / len(chunk) > 0.30


# ── Extension ────────────────────────────────────────────────────────────────


def _extension(name: str) -> str:
    """Matches the bash rules: dotfiles with no second dot get '', otherwise
    the suffix after the last dot (including the dot)."""
    if "." not in name:
        return ""
    if name.startswith("."):
        # Dotfile: only has an extension if there's ANOTHER dot after it.
        rest = name[1:]
        if "." not in rest:
            return ""
        return "." + name.rsplit(".", 1)[-1]
    return "." + name.rsplit(".", 1)[-1]


# ── Stat + line count ────────────────────────────────────────────────────────


def _epoch_to_iso(epoch: float) -> str:
    return (
        datetime.fromtimestamp(epoch, tz=timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def _stat_fields(entry: os.DirEntry[str]) -> tuple[int, str, str, float]:
    st = entry.stat()
    # macOS has st_birthtime; Linux doesn't, fall back to st_ctime
    birth = getattr(st, "st_birthtime", st.st_ctime)
    return st.st_size, _epoch_to_iso(birth), _epoch_to_iso(st.st_mtime), st.st_mtime


# Above this size, sample first 1 MB and extrapolate. Building height
# is relative, so ±20% on a 6+ MB file is fine and saves megabytes
# of read I/O per file.
_LINE_COUNT_FULL_THRESHOLD = 5 * 1024 * 1024   # 5 MB
_LINE_COUNT_SAMPLE_BYTES = 1 * 1024 * 1024     # 1 MB


def _line_count(path: Path) -> int:
    try:
        size = path.stat().st_size
        if size <= _LINE_COUNT_FULL_THRESHOLD:
            # Exact path — count every newline in 1 MB chunks.
            total = 0
            with path.open("rb") as fh:
                while True:
                    chunk = fh.read(1 << 20)
                    if not chunk:
                        break
                    total += chunk.count(b"\n")
            return total
        # Sample-extrapolate path.
        with path.open("rb") as fh:
            chunk = fh.read(_LINE_COUNT_SAMPLE_BYTES)
            sampled = chunk.count(b"\n")
        if sampled == 0:
            return 0
        return int(sampled * (size / _LINE_COUNT_SAMPLE_BYTES))
    except OSError:
        return 0


# ── Git metadata ─────────────────────────────────────────────────────────────


def _run_git(root: Path, *args: str) -> str:
    """Run git with CWD=root, return stdout. Empty string on failure."""
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except FileNotFoundError:
        return ""


def _is_git_repo(root: Path) -> bool:
    return _run_git(root, "rev-parse", "--git-dir").strip() != ""


def _git_history_window(override: str | None = None) -> str:
    """Resolve the git-log --since window.

    Precedence: explicit ``override`` argument (typically from a per-
    request UI/API parameter) > ``CODECITY_GIT_WINDOW`` env var > the
    built-in default of "3.years.ago". Any value `git log --since=…`
    accepts is valid: "3.years.ago", "2022-01-01", "6.months", etc.
    """
    if override:
        return override
    return os.environ.get("CODECITY_GIT_WINDOW", "3.years.ago")


def _collect_git_dates_windowed(
    root: Path, *, git_window: str | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """One newest→oldest `git log --name-status` walk that populates
    both created_map and modified_map in a single pass.

    Replaces two parallel walks (`--diff-filter=A --reverse` for creates
    + bare walk for modifies). Two wins:

      1. Halves the subprocess count — we now read the same history
         from one process, parsing both A-events and other-status
         events as we go.
      2. Bounds the walk to ``CODECITY_GIT_WINDOW`` (default 3 years).
         Files not touched within the window get no entry; the renderer
         falls back to filesystem dates or the oldest-age color. Cuts
         walks on torvalds/linux-scale repos from ~1.4M commits to
         ~250K. Acceptable because the age-signal renders colors
         relative to the visible date range — a file modified 10 years
         ago and one modified 4 years ago both clamp to the
         oldest-color bucket anyway.

    --no-renames means a rename is recorded as delete+add, so the
    `created` date reflects when the *current path* first appeared.
    For an age signal this is the right semantic (the user sees a
    building for the path, not for a file-identity).

    Walk direction is newest→oldest with first-sighting-wins, so:
      - modified[path] = date of the most recent commit touching path
      - created[path]  = date of the most recent `A`-status event for
        path within the window. For files added once and never
        re-added, this is the true creation date.
    """
    window = _git_history_window(git_window)
    _log(f"  starting git log walk (--since={window})…")
    try:
        proc = subprocess.Popen(
            ["git", "-C", str(root), "log",
             "--format=COMMIT:%aI",
             "--name-status",
             "--no-renames",
             f"--since={window}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        return {}, {}

    created: dict[str, str] = {}
    modified: dict[str, str] = {}
    current_date = ""
    commits = 0
    heartbeat_every = 25_000
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip("\n")
        if not line:
            continue
        if line.startswith("COMMIT:"):
            current_date = line[len("COMMIT:"):]
            commits += 1
            if commits % heartbeat_every == 0:
                _log(
                    f"  walked {commits:,} commits, "
                    f"{len(modified):,} files seen so far…"
                )
            continue
        # `<status>\t<path>` row from --name-status. Status is one of
        # A/M/D/T/U. With --no-renames, R/C don't appear (renames are
        # D + A instead).
        tab_idx = line.find("\t")
        if tab_idx == -1:
            continue
        status = line[:tab_idx]
        path = line[tab_idx + 1:]
        if path not in modified:
            modified[path] = current_date
        if status.startswith("A") and path not in created:
            created[path] = current_date
    proc.wait()
    _log(
        f"  done — {commits:,} commits in window, "
        f"{len(modified):,} files touched, "
        f"{len(created):,} with creation event"
    )
    return created, modified


def _collect_git_metadata(
    root: Path, *, use_cache: bool = True, git_window: str | None = None,
) -> tuple[dict[str, str], dict[str, str], set[str]]:
    """Return (created_map, modified_map, tracked_set).

    - created_map[path]  = ISO date of most recent ``A``-event for path
                           within ``CODECITY_GIT_WINDOW`` (default 3y).
                           Files added before the window are absent.
    - modified_map[path] = ISO date of most recent commit touching the
                           path within the window. Files untouched
                           since the window started are absent.
    - tracked_set        = all tracked paths + parent dirs (for the
                           gitignore filter — independent of history).

    Single `git log --name-status --no-renames --since=$WINDOW` walk
    populates both maps in one pass. With ``use_cache=True`` (default),
    the HEAD-keyed git-history cache short-circuits the walk when HEAD
    hasn't moved.
    """
    # Cache is keyed on (root, head_sha, window) — changing the window
    # invalidates because the maps' contents depend on it.
    window = _git_history_window(git_window)
    head_sha = _run_git(root, "rev-parse", "HEAD").strip()
    if use_cache and head_sha:
        cached = cache_load_git_history(root, head_sha, window)
        if cached is not None:
            created, modified = cached
            tracked = _collect_tracked_set(root)
            return created, modified, tracked

    _log("  collecting creation + modified dates…")
    created, modified = _collect_git_dates_windowed(root, git_window=window)
    _log(f"    {len(created)} created, {len(modified)} modified within window")

    _log("  listing tracked files…")
    tracked = _collect_tracked_set(root)
    _log(f"    {len(tracked)} tracked entries (files + dirs)")

    if use_cache and head_sha:
        try:
            cache_save_git_history(root, head_sha, window, created, modified)
        except OSError:
            # Cache failures (disk full, permission denied, read-only fs)
            # must never block a scan. The next run will retry the write.
            pass

    return created, modified, tracked


def _normalize_remote_to_web_url(remote: str) -> str:
    """Best-effort SSH/HTTPS remote → browseable web URL.

    Handles the two forms git users actually have configured:
      git@github.com:org/repo.git → https://github.com/org/repo
      https://github.com/org/repo(.git) → https://github.com/org/repo
    Anything that doesn't parse cleanly returns "" — the footer just
    won't render a link in that case.
    """
    if not remote:
        return ""
    s = remote.strip()
    # SSH form: git@host:path
    if s.startswith("git@") and ":" in s:
        host_path = s[len("git@"):]
        host, _, path = host_path.partition(":")
        if not host or not path:
            return ""
        s = f"https://{host}/{path}"
    if s.endswith(".git"):
        s = s[:-len(".git")]
    if not (s.startswith("http://") or s.startswith("https://")):
        return ""
    return s


def _collect_repo_info(root: Path) -> RepoInfo:
    """Repo-level git metadata for the manifest's `repo` field.

    Cheap-ish: one rev-parse, one symbolic-ref, one config read, one
    log -1, and one porcelain status. The status walk dominates on
    large dirty trees but is still a single git invocation.
    """
    info: RepoInfo = {
        "branch": None,
        "remote_url": None,
        "head_sha": None,
        "head_subject": None,
        "dirty": False,
    }

    branch = _run_git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch and branch != "HEAD":
        info["branch"] = branch
    elif branch == "HEAD":
        # Detached: surface the short SHA so the footer isn't blank.
        short = _run_git(root, "rev-parse", "--short", "HEAD").strip()
        info["branch"] = f"detached @ {short}" if short else "detached HEAD"

    remote = _run_git(root, "config", "--get", "remote.origin.url").strip()
    info["remote_url"] = _normalize_remote_to_web_url(remote) or None

    head_line = _run_git(root, "log", "-1", "--format=%h%x09%s").strip()
    if head_line:
        sha, _, subject = head_line.partition("\t")
        info["head_sha"] = sha or None
        info["head_subject"] = subject or None

    # --porcelain prints one line per changed/untracked path; non-empty
    # output means the working tree differs from HEAD or has untracked
    # files. Matches what most prompts mean by "dirty".
    status = _run_git(root, "status", "--porcelain")
    info["dirty"] = bool(status.strip())

    return info


# ── Skip list ────────────────────────────────────────────────────────────────

# Directory names that get skipped even when include_all=True. Keeps
# `Show all files` mode usable on a typical project — without this list
# enabling include_all pulls in node_modules/, .venv/, etc. and the
# city becomes useless noise.
#
# We deliberately do NOT include generic names like "dist", "build", "out".
# Those collide with legitimate source directories in real projects (CMake
# build configs, audio "out" stems, hand-written `dist/` source trees).
# Framework-specific build dirs (.next, .nuxt, etc.) are unambiguous and
# stay in the list.
#
# Per-project additions go in `<scan-root>/.codecityignore` (see
# _load_codecityignore). The skip list is always applied — there's no
# runtime escape hatch beyond editing this file or .codecityignore.
ALWAYS_SKIP: frozenset[str] = frozenset({
    ".git", ".hg", ".svn",                          # VCS
    "node_modules",                                 # JS
    ".venv", "venv", "env", "__pycache__",          # Python
    "target", ".cargo",                             # Rust
    ".next", ".nuxt", ".svelte-kit",                # framework caches
    ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".tox", ".coverage", "htmlcov",                 # test/coverage
    ".idea", ".vscode",                             # IDE state
    ".DS_Store",                                    # macOS junk
})


def _load_codecityignore(
    root: Path,
) -> tuple[frozenset[str], frozenset[str], frozenset[str], frozenset[str]]:
    """Load .codecityignore from the scan root.

    Returns ``(ignore_names, ignore_paths, unignore_names, unignore_paths)``.

    Lines without a '/' match any directory/file with that name anywhere
    in the tree (same semantic as ALWAYS_SKIP). Lines containing '/'
    are relative-path matches anchored to the scan root.

    A leading ``!`` un-ignores the entry, overriding ALWAYS_SKIP. For
    example, ``!node_modules`` walks into node_modules anywhere; the
    path form ``!tests/fixtures/large-repo`` un-ignores only that
    specific path. Negation does NOT override ``.git`` — walking the
    object database is always disallowed.

    Comments (#) and blank lines are ignored. Whitespace is stripped.
    A leading '/' is dropped (paths are always relative to root) AFTER
    the ``!`` prefix is consumed. Trailing '/' is stripped — directories
    vs files don't matter for skipping. Missing file or unreadable
    contents → four empty sets, no error (the file is optional).
    """
    names: set[str] = set()
    paths: set[str] = set()
    unignore_names: set[str] = set()
    unignore_paths: set[str] = set()
    try:
        text = (root / ".codecityignore").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return frozenset(), frozenset(), frozenset(), frozenset()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        negate = line.startswith("!")
        if negate:
            line = line[1:]
        line = line.removeprefix("/").removesuffix("/")
        if not line:
            continue
        target_names = unignore_names if negate else names
        target_paths = unignore_paths if negate else paths
        if "/" in line:
            target_paths.add(line)
        else:
            target_names.add(line)
    return (
        frozenset(names),
        frozenset(paths),
        frozenset(unignore_names),
        frozenset(unignore_paths),
    )


def _should_skip(
    name: str,
    rel_path: str,
    *,
    ignore_names: frozenset[str],
    ignore_paths: frozenset[str],
    unignore_names: frozenset[str],
    unignore_paths: frozenset[str],
) -> bool:
    """Whether to skip a directory entry during the walk.

    Order of precedence (first match wins):

    1. ``.git`` is always excluded — walking the object database is
       destructively expensive and never useful for visualization.
       The hardcoded check fires before any user override; ``!.git``
       in .codecityignore is silently ignored.
    2. Negation: any name in ``unignore_names`` or ``rel_path`` in
       ``unignore_paths`` (from .codecityignore lines beginning with
       ``!``) overrides ALWAYS_SKIP and the ignore lists below.
    3. ``ALWAYS_SKIP`` (hardcoded global noise dirs).
    4. ``ignore_names`` / ``ignore_paths`` (from .codecityignore).
    """
    if name == ".git":
        return True
    if name in unignore_names or rel_path in unignore_paths:
        return False
    if name in ALWAYS_SKIP:
        return True
    if name in ignore_names:
        return True
    if rel_path in ignore_paths:
        return True
    return False


# ── Tree walk ────────────────────────────────────────────────────────────────


# Both scan_tree and signature_tree feed bytes into the same hash; keeping
# the per-file and per-repo contributions in dedicated helpers is the
# contract that lets the cheap signature endpoint match the full scan's
# signature exactly. Don't inline these — drift here breaks live updates.
def _hash_file_entry(sig: Any, rel_path: str, size: int, mtime: float) -> None:
    sig.update(rel_path.encode("utf-8"))
    sig.update(b"\0")
    sig.update(str(size).encode("ascii"))
    sig.update(b"\0")
    sig.update(repr(mtime).encode("ascii"))
    sig.update(b"\0")


def _hash_repo_info(sig: Any, repo_info: RepoInfo) -> None:
    sig.update(
        (
            f"{repo_info['branch']}|{repo_info['remote_url']}|"
            f"{repo_info['head_sha']}|{repo_info['dirty']}"
        ).encode("utf-8")
    )


def _file_node(
    entry: os.DirEntry[str],
    rel_path: str,
    is_git_repo: bool,
    git_created: dict[str, str],
    git_modified: dict[str, str],
    sig: Any,
) -> FileNode:
    """Build a FileNode skeleton — `lines` and `binary` are placeholders
    that get filled in by _populate_file_metadata after the walk
    completes. Content I/O is deferred so it can be parallelized and
    cache-resolved in a single batch."""
    abs_path = entry.path
    size, created, modified, mtime = _stat_fields(entry)

    git_block: GitMeta | None = None
    if is_git_repo:
        git_block = {
            "created": git_created.get(rel_path) or None,
            "modified": git_modified.get(rel_path) or None,
        }

    _hash_file_entry(sig, rel_path, size, mtime)

    return {
        "name": entry.name,
        "type": NodeKind.FILE,
        "path": rel_path,
        "fullPath": abs_path,
        "extension": _extension(entry.name),
        "size": size,
        "lines": 0,         # filled in by _populate_file_metadata
        "binary": False,    # filled in by _populate_file_metadata
        "created": created,
        "modified": modified,
        "git": git_block,
    }


# Worker pool size for parallel file content reads. Capped at 32 to
# avoid pool-construction overhead on machines with very high cpu_count;
# doubling cpu_count gives oversubscription that helps when threads
# block on read().
_FILE_IO_POOL_SIZE = min(32, (os.cpu_count() or 1) * 2)


def _read_file_metadata(path_obj: Path) -> tuple[bool, int, int | None, int | None]:
    """Return (binary, lines, media_width, media_height) for one file.
    Worker function for _populate_file_metadata's thread pool. Media
    dims are None for non-media files or files the probe can't read."""
    binary = _is_binary(path_obj)
    lines = 0 if binary else _line_count(path_obj)
    mw, mh = probe_media_dims(path_obj)
    return binary, lines, mw, mh


def _node_mtime(node: FileNode) -> float:
    """Recover the float mtime for a FileNode by stat-ing fullPath.
    The node's `modified` field is an ISO string (lossy for cache
    comparison); the raw mtime feeds the cache directly."""
    try:
        return Path(node["fullPath"]).stat().st_mtime
    except OSError:
        return 0.0


def _populate_file_metadata(
    tree: DirNode, abs_root: Path, *, use_cache: bool,
    cancel_event: "threading.Event | None" = None,
) -> None:
    """Walk the skeleton tree and fill in `lines`, `binary`, and (for
    media files) `media_width` / `media_height` for every FileNode."""
    nodes: list[FileNode] = list(_iter_file_nodes(tree))
    if not nodes:
        return

    cache_entries: dict[str, FileEntry] = (
        cache_load_files(abs_root) if use_cache else {}
    )

    miss_indices: list[int] = []
    miss_paths: list[Path] = []
    for i, node in enumerate(nodes):
        rel = node["path"]
        cached = cache_entries.get(rel) if use_cache else None
        if (
            cached is not None
            and cached["size"] == node["size"]
            and cached["mtime"] == _node_mtime(node)
        ):
            node["binary"] = cached["binary"]
            node["lines"] = cached["lines"]
            mw = cached.get("media_width")
            mh = cached.get("media_height")
            if mw is not None and mh is not None:
                node["media_width"] = mw
                node["media_height"] = mh
            continue
        miss_indices.append(i)
        miss_paths.append(Path(node["fullPath"]))

    total = len(nodes)
    hits = total - len(miss_paths)
    _log(f"  populating metadata: {total} files ({hits} cache hits, {len(miss_paths)} to read)")

    if miss_paths:
        # Progress heartbeat: on a fresh clone this loop reads every file
        # to sniff binary/line-count/media-dims and can take 10s+ silent
        # seconds on a large repo. Log every N completions so the terminal
        # tracks the cache-miss work in real time.
        heartbeat_step = max(200, len(miss_paths) // 20)
        done = 0
        with ThreadPoolExecutor(max_workers=_FILE_IO_POOL_SIZE) as pool:
            future_to_idx = {
                pool.submit(_read_file_metadata, p): i
                for i, p in zip(miss_indices, miss_paths)
            }
            try:
                for fut in as_completed(future_to_idx):
                    if cancel_event is not None and cancel_event.is_set():
                        for f in future_to_idx:
                            f.cancel()
                        raise ScanCancelledError()
                    idx = future_to_idx[fut]
                    binary, lines, mw, mh = fut.result()
                    nodes[idx]["binary"] = binary
                    nodes[idx]["lines"] = lines
                    if mw is not None and mh is not None:
                        nodes[idx]["media_width"] = mw
                        nodes[idx]["media_height"] = mh
                    done += 1
                    if done % heartbeat_step == 0:
                        _log(f"    read {done}/{len(miss_paths)} files…")
            except ScanCancelledError:
                pool.shutdown(wait=False)
                raise
        _log(f"    read {len(miss_paths)}/{len(miss_paths)} files")

    if use_cache:
        # Union-merge: start from the loaded cache (preserves entries
        # for files not visited this scan, e.g. when include_all flips)
        # and overwrite with current values for everything we did visit.
        for node in nodes:
            entry: FileEntry = {
                "size": node["size"],
                "mtime": _node_mtime(node),
                "lines": node["lines"],
                "binary": node["binary"],
                "ext": node["extension"],
            }
            if "media_width" in node and "media_height" in node:
                entry["media_width"] = node["media_width"]
                entry["media_height"] = node["media_height"]
            cache_entries[node["path"]] = entry
        try:
            cache_save_files(abs_root, cache_entries)
        except OSError:
            pass


def _iter_file_nodes(tree: DirNode) -> Iterator[FileNode]:
    """Yield every FileNode in the tree (depth-first, alphabetical)."""
    for child in tree["children"]:
        if child["type"] == NodeKind.FILE:
            yield child  # type: ignore[misc]
        else:
            yield from _iter_file_nodes(child)  # type: ignore[arg-type]


# Global tracker for heartbeat logging during recursion.
_files_seen = 0


def _reset_heartbeat() -> None:
    global _files_seen
    _files_seen = 0


def _tick_heartbeat() -> None:
    global _files_seen
    _files_seen += 1
    if _files_seen % 100 == 0:
        _log(f"  walked {_files_seen} files so far…")


def _build_tree(
    abs_dir: str,
    rel_dir: str,
    *,
    is_git_repo: bool,
    git_created: dict[str, str],
    git_modified: dict[str, str],
    tracked_files: set[str],
    include_all: bool,
    ignore_names: frozenset[str],
    ignore_paths: frozenset[str],
    unignore_names: frozenset[str],
    unignore_paths: frozenset[str],
    sig: Any,
) -> DirNode:
    name = os.path.basename(abs_dir)

    files: list[FileNode] = []
    dirs: list[DirNode] = []
    descendants_count = 0
    descendants_file_count = 0
    descendants_dir_count = 0
    descendants_size = 0

    # Sort entries alphabetically for deterministic output.
    try:
        entries = sorted(os.scandir(abs_dir), key=lambda e: e.name)
    except OSError:
        entries = []

    for entry in entries:
        entry_rel = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"

        if _should_skip(
            entry.name, entry_rel,
            ignore_names=ignore_names, ignore_paths=ignore_paths,
            unignore_names=unignore_names, unignore_paths=unignore_paths,
        ):
            continue

        # In a git repo, skip anything not tracked (covers .gitignore + uncommitted
        # additions) — unless include_all is on, the user's "show me everything"
        # escape hatch. Outside a repo, the tracked set is empty so the
        # default-OFF branch is a no-op.
        if is_git_repo and not include_all and entry_rel not in tracked_files:
            continue

        if entry.is_file(follow_symlinks=False):
            node = _file_node(
                entry, entry_rel, is_git_repo, git_created, git_modified, sig
            )
            files.append(node)
            descendants_count += 1
            descendants_file_count += 1
            descendants_size += node["size"]
            _tick_heartbeat()
        elif entry.is_dir(follow_symlinks=False):
            subtree = _build_tree(
                entry.path, entry_rel,
                is_git_repo=is_git_repo,
                git_created=git_created, git_modified=git_modified,
                tracked_files=tracked_files, include_all=include_all,
                ignore_names=ignore_names, ignore_paths=ignore_paths,
                unignore_names=unignore_names, unignore_paths=unignore_paths,
                sig=sig,
            )
            dirs.append(subtree)
            descendants_count += 1 + subtree["descendants_count"]
            descendants_file_count += subtree["descendants_file_count"]
            descendants_dir_count += 1 + subtree["descendants_dir_count"]
            descendants_size += subtree["descendants_size"]

    children: list[FileNode | DirNode] = [*files, *dirs]
    return {
        "name": name,
        "type": NodeKind.DIRECTORY,
        "path": rel_dir,
        "fullPath": abs_dir,
        "children_count": len(children),
        "children_file_count": len(files),
        "children_dir_count": len(dirs),
        "descendants_count": descendants_count,
        "descendants_file_count": descendants_file_count,
        "descendants_dir_count": descendants_dir_count,
        "descendants_size": descendants_size,
        "children": children,
    }


# ── Public entry ─────────────────────────────────────────────────────────────


def compute_tree_signature(tree_root: dict) -> str:
    """Stable fingerprint of the manifest tree's structure.

    Ignores per-file metadata; depends ONLY on the set of paths and
    their nesting. Returns the same value for skeleton and final
    manifests of the same scan, and for live-update polls until the
    tree shape actually changes.

    Uses blake2b with digest_size=8 (16-char hex string). Children are
    sorted by path before walking — scan.py already sorts entries
    alphabetically during _build_tree, so this sort is a no-op in
    practice, but we apply it defensively to guarantee determinism if
    the tree-builder ever changes its iteration order.
    """
    h = hashlib.blake2b(digest_size=8)

    def _walk(node: dict) -> None:
        path = node.get("path", "") or ""
        h.update(path.encode("utf-8"))
        h.update(b"\x00")
        children = node.get("children") or []
        # Sort by path for determinism (no-op when _build_tree already sorts).
        for c in sorted(children, key=lambda n: n.get("path", "") or ""):
            _walk(c)

    _walk(tree_root)
    return h.hexdigest()


def _wrap_skeleton(
    root_abs: str, tree: DirNode, sig: Any, tree_signature: str, repo_info: RepoInfo | None,
) -> Manifest:
    """Build a Manifest envelope for the skeleton-phase emit. Caller is
    responsible for having already deep-copied the tree and applied
    placeholder values via _force_skeleton_placeholders — this helper
    is a pure envelope builder."""
    return {
        "root": root_abs,
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signature": sig.hexdigest(),
        "tree_signature": tree_signature,
        "tree": tree,
        "repo": repo_info,
    }


def _wrap_final(
    root_abs: str, tree: DirNode, sig: Any, tree_signature: str, repo_info: RepoInfo | None,
) -> Manifest:
    """Build a Manifest envelope for the final-phase emit. Called after
    _populate_file_metadata has filled in real lines/binary values."""
    return {
        "root": root_abs,
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signature": sig.hexdigest(),
        "tree_signature": tree_signature,
        "tree": tree,
        "repo": repo_info,
    }


def _force_skeleton_placeholders(node: DirNode | FileNode) -> None:
    """In-place: set every FileNode under `node` to lines=1, binary=False
    so the skeleton renders with uniform-height buildings."""
    if node["type"] == NodeKind.FILE:
        node["lines"] = 1  # type: ignore[typeddict-item]
        node["binary"] = False  # type: ignore[typeddict-item]
        return
    for child in node.get("children", []):  # type: ignore[union-attr]
        _force_skeleton_placeholders(child)


def scan_tree_streaming(
    root: str,
    *,
    include_all: bool = False,
    use_cache: bool = True,
    cancel_event: "threading.Event | None" = None,
    git_window: str | None = None,
) -> Iterator["ScanStreamEvent"]:
    """Generator form of scan_tree: yields a skeleton event after the
    tree walk, then a final event after metadata population. The
    eager scan_tree() wrapper drains this and returns the final
    manifest, preserving the original API for non-streaming callers
    (CLI, tests that don't care about phasing)."""
    root_abs = str(Path(root).resolve())
    _log(f"resolving {root_abs}")

    _check_cancel(cancel_event)  # before _collect_git_metadata

    git_created: dict[str, str] = {}
    git_modified: dict[str, str] = {}
    tracked_files: set[str] = set()
    is_git_repo = _is_git_repo(Path(root_abs))
    repo_info: RepoInfo | None = None

    if is_git_repo:
        _log("git repo detected — collecting metadata…")
        git_created, git_modified, tracked_files = _collect_git_metadata(
            Path(root_abs), use_cache=use_cache, git_window=git_window,
        )
        repo_info = _collect_repo_info(Path(root_abs))
    else:
        _log("not a git repo — filesystem dates only")

    _check_cancel(cancel_event)  # after git metadata, before tree walk

    ignore_names, ignore_paths, unignore_names, unignore_paths = (
        _load_codecityignore(Path(root_abs))
    )

    _reset_heartbeat()
    _log("walking tree…")
    sig = hashlib.blake2b(digest_size=16)
    tree = _build_tree(
        root_abs, ".",
        is_git_repo=is_git_repo,
        git_created=git_created, git_modified=git_modified,
        tracked_files=tracked_files, include_all=include_all,
        ignore_names=ignore_names, ignore_paths=ignore_paths,
        unignore_names=unignore_names, unignore_paths=unignore_paths,
        sig=sig,
    )
    _log(f"walked {_files_seen} files; emitting skeleton")

    # Compute tree_signature once after the tree is built. This is
    # structure-only (paths + nesting, NO mtime/size/metadata), so it is
    # identical for skeleton and final manifests of the same scan.
    tree_sig = compute_tree_signature(tree)

    _check_cancel(cancel_event)  # after tree walk, before skeleton emit

    # We deep-copy here so the skeleton's placeholder-mutation doesn't
    # affect the tree that _populate_file_metadata is about to modify
    # in-place. Cheap for small repos; for Linux this is ~50ms.
    skeleton_tree = copy.deepcopy(tree)
    _force_skeleton_placeholders(skeleton_tree)
    yield {
        "phase": "skeleton",
        "manifest": _wrap_skeleton(root_abs, skeleton_tree, sig, tree_sig, repo_info),
    }

    _log("resolving file metadata")
    _populate_file_metadata(
        tree, Path(root_abs), use_cache=use_cache, cancel_event=cancel_event,
    )
    _check_cancel(cancel_event)  # after populate, before final emit
    _log("emitting final manifest")

    # Repo-level metadata — branch, remote, head, dirty — feeds the
    # signature so the footer's "live" indicator catches a checkout or
    # commit without waiting for file mtimes to shift.
    if repo_info is not None:
        _hash_repo_info(sig, repo_info)

    yield {
        "phase": "final",
        "manifest": _wrap_final(root_abs, tree, sig, tree_sig, repo_info),
    }


def scan_tree(
    root: str,
    *,
    include_all: bool = False,
    use_cache: bool = True,
    git_window: str | None = None,
) -> Manifest:
    """Scan a directory and return the full manifest.

    With ``include_all=False`` (default), in a git repo the scanner walks
    only paths in ``git ls-files`` — gitignored and untracked files are
    hidden. With ``include_all=True``, the tracked-files filter is
    skipped entirely; every file under ``root`` is emitted EXCEPT
    those in ALWAYS_SKIP (``node_modules``, ``.venv``, ``.git``, etc.)
    or matched by the optional ``<root>/.codecityignore`` file.

    Outside a git repo, ``include_all`` has no effect — the tracked set
    is empty either way.

    The skip list is always applied. Per-project additions go in
    ``<root>/.codecityignore`` (one literal name per line, or relative
    paths containing ``/``).

    Eager wrapper: drains scan_tree_streaming and returns the final
    manifest. Preserves the existing API for callers that don't
    stream (CLI, older tests).
    """
    final: Manifest | None = None
    for event in scan_tree_streaming(
        root, include_all=include_all, use_cache=use_cache, git_window=git_window,
    ):
        if event["phase"] == "final":
            final = event["manifest"]
    assert final is not None, "scan_tree_streaming must yield a final event"
    return final


def _collect_tracked_set(root: Path) -> set[str]:
    """Just the tracked-files set from `git ls-files` (no per-file history).

    Cheaper subset of _collect_git_metadata for callers that only need
    the gitignore filter, not the per-file created/modified maps. The
    returned set includes parent directories of every tracked file.
    """
    tracked: set[str] = set()
    out = _run_git(root, "ls-files")
    for line in out.splitlines():
        if not line:
            continue
        tracked.add(line)
        parts = line.split("/")
        for i in range(1, len(parts)):
            tracked.add("/".join(parts[:i]))
    return tracked


def _walk_for_signature(
    abs_dir: str,
    rel_dir: str,
    *,
    is_git_repo: bool,
    tracked_files: set[str],
    include_all: bool,
    ignore_names: frozenset[str],
    ignore_paths: frozenset[str],
    unignore_names: frozenset[str],
    unignore_paths: frozenset[str],
    sig: Any,
) -> None:
    """Stat-only walk that feeds the live signature without building nodes.

    Mirrors _build_tree's iteration order and gitignore filter so the
    bytes it pushes into `sig` are byte-identical to scan_tree's output.
    Skips _is_binary, _line_count, and per-file git history — that's
    where the cost lives on a large repo.
    """
    try:
        entries = sorted(os.scandir(abs_dir), key=lambda e: e.name)
    except OSError:
        return

    for entry in entries:
        entry_rel = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"
        if _should_skip(
            entry.name, entry_rel,
            ignore_names=ignore_names, ignore_paths=ignore_paths,
            unignore_names=unignore_names, unignore_paths=unignore_paths,
        ):
            continue
        if is_git_repo and not include_all and entry_rel not in tracked_files:
            continue
        if entry.is_file(follow_symlinks=False):
            size, _created, _modified, mtime = _stat_fields(entry)
            _hash_file_entry(sig, entry_rel, size, mtime)
        elif entry.is_dir(follow_symlinks=False):
            _walk_for_signature(
                entry.path, entry_rel,
                is_git_repo=is_git_repo,
                tracked_files=tracked_files,
                include_all=include_all,
                ignore_names=ignore_names,
                ignore_paths=ignore_paths,
                unignore_names=unignore_names,
                unignore_paths=unignore_paths,
                sig=sig,
            )


def signature_tree(
    root: str,
    *,
    include_all: bool = False,
    use_cache: bool = True,
) -> SignatureResponse:
    """Cheap fingerprint of the tree — equivalent to scan_tree(root, include_all=…)['signature']
    but without building the full manifest.

    Walks the tree once with os.scandir, hashing (rel_path, size, mtime)
    plus repo-level git fields (branch / remote / head / dirty). Skips
    file content reads and the two `git log` walks scan_tree uses for
    per-file created/modified history; both are cost-dominant on a big
    repo and don't feed the signature anyway.

    With ``include_all=True``, skips the tracked-files lookup as well —
    the filter isn't applied so we don't need to compute it.

    Honors the same skip list and ``<root>/.codecityignore`` file as
    scan_tree, so signatures stay in lockstep.

    ``use_cache`` is accepted for API symmetry with scan_tree (so both
    /api/manifest and /api/manifest/signature take the same query
    params) but is a no-op here — signature_tree doesn't compute
    per-file lines/binary or per-file git history, so there's nothing
    to cache.
    """
    root_abs = str(Path(root).resolve())
    root_path = Path(root_abs)
    is_git_repo = _is_git_repo(root_path)
    tracked_files: set[str] = set()
    repo_info: RepoInfo | None = None

    if is_git_repo:
        # Tracked set is only used by the filter; skip the git call when
        # include_all bypasses the filter.
        if not include_all:
            tracked_files = _collect_tracked_set(root_path)
        repo_info = _collect_repo_info(root_path)

    ignore_names, ignore_paths, unignore_names, unignore_paths = (
        _load_codecityignore(root_path)
    )

    sig = hashlib.blake2b(digest_size=16)
    _walk_for_signature(
        root_abs, ".",
        is_git_repo=is_git_repo,
        tracked_files=tracked_files,
        include_all=include_all,
        ignore_names=ignore_names,
        ignore_paths=ignore_paths,
        unignore_names=unignore_names,
        unignore_paths=unignore_paths,
        sig=sig,
    )
    if repo_info is not None:
        _hash_repo_info(sig, repo_info)

    return {
        "root": root_abs,
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signature": sig.hexdigest(),
    }


# ── CLI entry ────────────────────────────────────────────────────────────────


def _cli() -> int:
    p = argparse.ArgumentParser(description="Walk a directory tree and emit a JSON manifest.")
    p.add_argument("--root", required=True, help="Directory to scan.")
    args = p.parse_args()

    manifest = scan_tree(args.root)
    json.dump(manifest, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
