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
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .types import (
    DirNode,
    FileNode,
    GitMeta,
    Manifest,
    NodeKind,
    RepoInfo,
    SignatureResponse,
)


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
    tracked = _collect_tracked_set(root)
    _log(f"    {len(tracked)} tracked entries (files + dirs)")

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
    abs_path = entry.path
    size, created, modified, mtime = _stat_fields(entry)
    path_obj = Path(abs_path)

    binary = _is_binary(path_obj)
    lines = 0 if binary else _line_count(path_obj)

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
        "lines": lines,
        "binary": binary,
        "created": created,
        "modified": modified,
        "git": git_block,
    }


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
        if entry.name == ".git":
            continue

        entry_rel = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"

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
                tracked_files=tracked_files, include_all=include_all, sig=sig,
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


def scan_tree(root: str, *, include_all: bool = False) -> Manifest:
    """Scan a directory and return the full manifest.

    With ``include_all=False`` (default), in a git repo the scanner walks
    only paths in ``git ls-files`` — gitignored and untracked files are
    hidden. With ``include_all=True``, the tracked-files filter is
    skipped entirely; every file under ``root`` (except the ``.git``
    directory itself) is emitted. ``.git`` is always excluded.

    Outside a git repo, ``include_all`` has no effect — the tracked set
    is empty either way.
    """
    root_abs = str(Path(root).resolve())
    _log(f"resolving {root_abs}")

    git_created: dict[str, str] = {}
    git_modified: dict[str, str] = {}
    tracked_files: set[str] = set()
    is_git_repo = _is_git_repo(Path(root_abs))
    repo_info: RepoInfo | None = None

    if is_git_repo:
        _log("git repo detected — collecting metadata…")
        git_created, git_modified, tracked_files = _collect_git_metadata(
            Path(root_abs)
        )
        repo_info = _collect_repo_info(Path(root_abs))
    else:
        _log("not a git repo — filesystem dates only")

    _reset_heartbeat()
    _log("walking tree…")
    sig = hashlib.blake2b(digest_size=16)
    tree = _build_tree(
        root_abs, ".",
        is_git_repo=is_git_repo,
        git_created=git_created, git_modified=git_modified,
        tracked_files=tracked_files, include_all=include_all, sig=sig,
    )
    _log(f"walked {_files_seen} files; emitting manifest")

    # Repo-level metadata — branch, remote, head, dirty — feeds the
    # signature so the footer's "live" indicator catches a checkout or
    # commit without waiting for file mtimes to shift.
    if repo_info is not None:
        _hash_repo_info(sig, repo_info)

    return {
        "root": root_abs,
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signature": sig.hexdigest(),
        "tree": tree,
        "repo": repo_info,
    }


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
        if entry.name == ".git":
            continue
        entry_rel = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"
        if is_git_repo and entry_rel not in tracked_files:
            continue
        if entry.is_file(follow_symlinks=False):
            size, _created, _modified, mtime = _stat_fields(entry)
            _hash_file_entry(sig, entry_rel, size, mtime)
        elif entry.is_dir(follow_symlinks=False):
            _walk_for_signature(
                entry.path, entry_rel,
                is_git_repo=is_git_repo,
                tracked_files=tracked_files,
                sig=sig,
            )


def signature_tree(root: str) -> SignatureResponse:
    """Cheap fingerprint of the tree — equivalent to scan_tree(root)['signature']
    but without building the full manifest.

    Walks the tree once with os.scandir, hashing (rel_path, size, mtime)
    plus repo-level git fields (branch / remote / head / dirty). Skips
    file content reads and the two `git log` walks scan_tree uses for
    per-file created/modified history; both are cost-dominant on a big
    repo and don't feed the signature anyway.
    """
    root_abs = str(Path(root).resolve())
    root_path = Path(root_abs)
    is_git_repo = _is_git_repo(root_path)
    tracked_files: set[str] = set()
    repo_info: RepoInfo | None = None

    if is_git_repo:
        tracked_files = _collect_tracked_set(root_path)
        repo_info = _collect_repo_info(root_path)

    sig = hashlib.blake2b(digest_size=16)
    _walk_for_signature(
        root_abs, ".",
        is_git_repo=is_git_repo,
        tracked_files=tracked_files,
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
