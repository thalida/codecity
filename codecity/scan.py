#!/usr/bin/env python3
"""scan.py — CodeCity filesystem scanner.

Walks a directory tree, collects file/directory metadata + git history
(created/modified dates only), and emits a nested JSON manifest.

Invoked by codecity.py, or directly as a CLI:

    python3 scan.py --root <path>
                    [--depth <N>] [--include <glob>] [--exclude <glob>]
                    [--no-gitignore]

Outputs manifest JSON on stdout; progress on stderr. Silence progress
with CODECITY_QUIET=1.

This script replaces the previous scan.sh + jq pipeline. In-memory
Python assembly is ~20× faster than the bash version was.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


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


def _stat_fields(entry: os.DirEntry) -> tuple[int, str, str]:
    st = entry.stat()
    # macOS has st_birthtime; Linux doesn't, fall back to st_ctime
    birth = getattr(st, "st_birthtime", st.st_ctime)
    return st.st_size, _epoch_to_iso(birth), _epoch_to_iso(st.st_mtime)


def _line_count(path: Path) -> int:
    # Count b'\n' in chunks to avoid loading huge files into memory.
    total = 0
    try:
        with path.open("rb") as fh:
            while True:
                chunk = fh.read(1 << 20)  # 1 MB
                if not chunk:
                    break
                total += chunk.count(b"\n")
    except OSError:
        return 0
    return total


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


def _collect_git_metadata(root: Path) -> tuple[dict[str, str], dict[str, str], set[str]]:
    """Return (created_map, modified_map, tracked_set).

    - created_map[path]  = earliest add-commit ISO date
    - modified_map[path] = most recent commit-that-touched-it ISO date
    - tracked_set        = all tracked paths + their parent dirs (for gitignore filter)
    """
    created: dict[str, str] = {}
    modified: dict[str, str] = {}
    tracked: set[str] = set()

    # Created: walk in chronological order, first occurrence wins (oldest).
    _log("  collecting creation dates (one git log walk)…")
    out = _run_git(
        root, "log", "--reverse",
        "--format=COMMIT:%aI", "--name-only", "--diff-filter=A",
    )
    current_date = ""
    for line in out.splitlines():
        if line.startswith("COMMIT:"):
            current_date = line[len("COMMIT:"):]
        elif line and line not in created:
            created[line] = current_date
    _log(f"    {len(created)} files")

    # Modified: reverse-chron (git default), first occurrence wins (most recent).
    _log("  collecting modified dates (one git log walk)…")
    out = _run_git(
        root, "log",
        "--format=COMMIT:%aI", "--name-only",
    )
    current_date = ""
    for line in out.splitlines():
        if line.startswith("COMMIT:"):
            current_date = line[len("COMMIT:"):]
        elif line and line not in modified:
            modified[line] = current_date
    _log(f"    {len(modified)} files")

    # Tracked set (for .gitignore filter) — includes parent dirs.
    _log("  listing tracked files…")
    out = _run_git(root, "ls-files")
    for line in out.splitlines():
        if not line:
            continue
        tracked.add(line)
        # Mark every parent dir as tracked too.
        parts = line.split("/")
        for i in range(1, len(parts)):
            tracked.add("/".join(parts[:i]))
    _log(f"    {len(tracked)} tracked entries (files + dirs)")

    return created, modified, tracked


# ── Tree walk ────────────────────────────────────────────────────────────────


def _file_node(
    entry: os.DirEntry,
    rel_path: str,
    is_git_repo: bool,
    git_created: dict[str, str],
    git_modified: dict[str, str],
) -> dict:
    abs_path = entry.path
    size, created, modified = _stat_fields(entry)
    path_obj = Path(abs_path)

    binary = _is_binary(path_obj)
    lines = 0 if binary else _line_count(path_obj)

    git_block = None
    if is_git_repo:
        git_block = {
            "created": git_created.get(rel_path) or None,
            "modified": git_modified.get(rel_path) or None,
        }

    return {
        "name": entry.name,
        "type": "file",
        "path": rel_path,
        "fullPath": abs_path,
        "extension": _extension(entry.name),
        "size": size,
        "lines": lines,
        "binary": binary,
        "created": created,
        "modified": modified,
        "git": git_block,
    }


def _dir_stub(entry: os.DirEntry, rel_path: str) -> dict:
    """A directory node emitted without recursing (depth limit)."""
    return {
        "name": entry.name,
        "type": "directory",
        "path": rel_path,
        "fullPath": entry.path,
        "children_count": 0,
        "children_file_count": 0,
        "children_dir_count": 0,
        "descendants_count": 0,
        "descendants_file_count": 0,
        "descendants_dir_count": 0,
        "descendants_size": 0,
        "children": [],
    }


# Global tracker for heartbeat logging during recursion.
_FILES_SEEN = 0


def _reset_heartbeat() -> None:
    global _FILES_SEEN
    _FILES_SEEN = 0


def _tick_heartbeat() -> None:
    global _FILES_SEEN
    _FILES_SEEN += 1
    if _FILES_SEEN % 100 == 0:
        _log(f"  walked {_FILES_SEEN} files so far…")


def _build_tree(
    abs_dir: str,
    rel_dir: str,
    current_depth: int,
    *,
    depth: Optional[int],
    include: Optional[str],
    exclude: Optional[str],
    gitignore: bool,
    is_git_repo: bool,
    git_created: dict[str, str],
    git_modified: dict[str, str],
    tracked_files: set[str],
    root_abs: str,
) -> dict:
    name = os.path.basename(abs_dir)

    files: list[dict] = []
    dirs: list[dict] = []
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
        if entry.name == ".git":
            continue

        entry_rel = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"

        # .gitignore filter: in a git repo, only include tracked paths.
        if is_git_repo and gitignore and entry_rel not in tracked_files:
            continue

        if entry.is_file(follow_symlinks=False):
            if include and not fnmatch.fnmatch(entry.name, include):
                continue
            if exclude and fnmatch.fnmatch(entry.name, exclude):
                continue
            node = _file_node(entry, entry_rel, is_git_repo, git_created, git_modified)
            files.append(node)
            descendants_count += 1
            descendants_file_count += 1
            descendants_size += node["size"]
            _tick_heartbeat()
        elif entry.is_dir(follow_symlinks=False):
            if depth is not None and current_depth + 1 >= depth:
                dirs.append(_dir_stub(entry, entry_rel))
                descendants_count += 1
                descendants_dir_count += 1
            else:
                subtree = _build_tree(
                    entry.path, entry_rel, current_depth + 1,
                    depth=depth, include=include, exclude=exclude,
                    gitignore=gitignore, is_git_repo=is_git_repo,
                    git_created=git_created, git_modified=git_modified,
                    tracked_files=tracked_files, root_abs=root_abs,
                )
                dirs.append(subtree)
                descendants_count += 1 + subtree["descendants_count"]
                descendants_file_count += subtree["descendants_file_count"]
                descendants_dir_count += 1 + subtree["descendants_dir_count"]
                descendants_size += subtree["descendants_size"]

    children = files + dirs
    return {
        "name": name,
        "type": "directory",
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


def scan_tree(
    root: str,
    *,
    depth: Optional[int] = None,
    include: Optional[str] = None,
    exclude: Optional[str] = None,
    gitignore: bool = True,
) -> dict:
    root_abs = str(Path(root).resolve())
    _log(f"resolving {root_abs}")

    git_created: dict[str, str] = {}
    git_modified: dict[str, str] = {}
    tracked_files: set[str] = set()
    is_git_repo = _is_git_repo(Path(root_abs))

    if is_git_repo:
        _log("git repo detected — collecting metadata…")
        git_created, git_modified, tracked_files = _collect_git_metadata(
            Path(root_abs)
        )
    else:
        _log("not a git repo — filesystem dates only")

    _reset_heartbeat()
    _log("walking tree…")
    tree = _build_tree(
        root_abs, ".", 0,
        depth=depth, include=include, exclude=exclude,
        gitignore=gitignore, is_git_repo=is_git_repo,
        git_created=git_created, git_modified=git_modified,
        tracked_files=tracked_files, root_abs=root_abs,
    )
    _log(f"walked {_FILES_SEEN} files; emitting manifest")

    return {
        "root": root_abs,
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "depth": depth,
        "tree": tree,
    }


# ── CLI entry ────────────────────────────────────────────────────────────────


def _cli() -> int:
    p = argparse.ArgumentParser(description="Walk a directory tree and emit a JSON manifest.")
    p.add_argument("--root", required=True, help="Directory to scan.")
    p.add_argument("--depth", type=int, default=None, help="Max directory depth (unlimited by default).")
    p.add_argument("--include", default=None, help="Only include filenames matching this glob.")
    p.add_argument("--exclude", default=None, help="Exclude filenames matching this glob.")
    p.add_argument("--no-gitignore", dest="gitignore", action="store_false",
                   help="Include files even if .gitignored.")
    p.set_defaults(gitignore=True)
    args = p.parse_args()

    manifest = scan_tree(
        args.root,
        depth=args.depth,
        include=args.include,
        exclude=args.exclude,
        gitignore=args.gitignore,
    )
    json.dump(manifest, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
