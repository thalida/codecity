"""scan.py — CodeCity filesystem scanner.

Walks a directory tree, collects file/directory metadata + git history
(created/modified dates only), and emits a nested JSON manifest.

Invoked by the server's /api/manifest handler. Progress goes to stderr;
silence it with CODECITY_QUIET=1.

In a git repo, only tracked files are scanned (parents of tracked files
are walked but unstaged additions and gitignored paths are skipped).
"""

from __future__ import annotations

import copy
import hashlib
import os
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, NamedTuple

from api.config import quiet
from api.models.events import ScanEvent
from .date_utils import max_iso, min_iso
from . import gitobj
from .cache import (
    BlobEntry,
    FileEntry,
    cache_load_blobs,
    cache_load_files,
    cache_load_git_history,
    cache_save_blobs,
    cache_save_files,
    cache_save_git_history,
)
from .binfmt import detect_binary_type
from .gitobj import BINARY_CHUNK, is_binary_bytes
from .media import media_kind, probe_media_dims
from .stats import compute_repo_stats
from .manifest_types import (
    BusynessThresholds,
    CommitEntry,
    DateRanges,
    DirNode,
    ExtBreakdownEntry,
    FileNode,
    Manifest,
    NodeKind,
    RepoInfo,
    ScanStreamEvent,
    SignatureResponse,
    TreeNode,
)


class ScanCancelledError(Exception):
    """Raised when a scan_tree cancel_event is set mid-scan.

    The server's disconnect watchdog sets the event, the scanner
    polls it at every phase boundary, and the server's outer try/
    except catches this so cancellation isn't surfaced as a 5xx."""


class NotAGitRepoError(ValueError):
    """Raised by scan_tree / signature_tree when handed a root that
    isn't a git working tree. The server enforces git-only at the HTTP
    boundary; this is defense-in-depth so direct callers get a clean
    failure instead of an empty or partial manifest."""


__all__ = [
    "NotAGitRepoError",
    "ScanCancelledError",
    "build_authors_list",
    "reconstruct_manifest",
    "scan_tree",
    "signature_tree",
]


def _check_cancel(event: "threading.Event | None") -> None:
    """Raise ScanCancelledError if the cancellation event is set.

    Cheap; called at every phase boundary in scan_tree and
    between batches in _populate_file_metadata."""
    if event is not None and event.is_set():
        raise ScanCancelledError()


# ── Progress logging ─────────────────────────────────────────────────────────


def _log(msg: str) -> None:
    if not quiet():
        print(f"[scan] {msg}", file=sys.stderr, flush=True)


# ── Binary detection ─────────────────────────────────────────────────────────
#
# The heuristic itself lives in gitobj.is_binary_bytes — the live scan
# (here) and the time-travel reconstruction (gitobj.blob_stats_batch) must
# classify the same file content identically, or a file's binary/line-count
# would differ between the live city and its past-commit reconstruction.


def _is_binary(path: Path) -> bool:
    """Null-byte / non-text-char heuristic. Fast, no subprocess."""
    try:
        with path.open("rb") as fh:
            chunk = fh.read(BINARY_CHUNK)
    except OSError:
        return True
    return is_binary_bytes(chunk)


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
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _day_key(commit: "CommitEntry") -> str:
    """Calendar day of a commit, for the same-day aggregates. `date` carries a
    full timestamp, so the day has to be sliced back out."""
    return commit["date"][:10]


def _git_iso_to_utc(iso: str) -> str:
    """Normalize a git %aI date (which carries the author's UTC offset,
    e.g. +02:00) to the same Z-suffixed UTC format _epoch_to_iso emits.
    Every date on the wire then shares one format, so lexical order ==
    chronological order (which _derive_tree_signals' date-range pass relies
    on). Returns
    the input unchanged if it doesn't parse (defensive; %aI always
    parses)."""
    try:
        return (
            datetime.fromisoformat(iso)
            .astimezone(timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ")
        )
    except ValueError:
        return iso


def _stat_fields(entry: os.DirEntry[str]) -> tuple[int, str, str, float]:
    st = entry.stat()
    # macOS has st_birthtime; Linux doesn't, fall back to st_ctime
    birth = getattr(st, "st_birthtime", st.st_ctime)
    return st.st_size, _epoch_to_iso(birth), _epoch_to_iso(st.st_mtime), st.st_mtime


def _line_count(path: Path) -> int:
    # Exact streamed count (no sampling), same rule as gitobj.count_lines so a
    # file's Live count equals its Timeline blob count.
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


# ── Git metadata ─────────────────────────────────────────────────────────────


def _run_git(root: Path, *args: str) -> str:
    """Run git with CWD=root, return stdout. Empty string on failure.

    Includes ``-c safe.directory=*`` so the scanner can read repos
    whose ownership doesn't match the process uid — common in CI /
    container setups where the bind-mounted workspace is owned by a
    different user than the one running pytest. Without this, git
    2.35+ refuses with "dubious ownership" and we silently get an
    empty stdout, which manifests downstream as an empty manifest
    (0 tracked files, 0 commits). codecity intentionally scans
    arbitrary repos, so disabling the check globally for this
    invocation is appropriate.
    """
    try:
        return subprocess.run(
            ["git", "-c", "safe.directory=*", "-C", str(root), *args],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except FileNotFoundError:
        return ""


def _is_git_repo(root: Path) -> bool:
    return _run_git(root, "rev-parse", "--git-dir").strip() != ""


# Matches "Name <email>" — captures name (group 1) and email (group 2).
# Name may be empty (e.g. "<bot@host>"); the helper falls back to the
# email's local-part (before the @) in that case so the public authors
# list never leaks an address.
_NAME_EMAIL = re.compile(r"^\s*(.*?)\s*<([^>]*)>\s*$")


def build_authors_list(primary: str, trailers_raw: str) -> list[str]:
    """Combine primary author + Co-authored-by trailer values into a
    deduped author list (primary at index 0).

    `trailers_raw` is git's `%(trailers:key=Co-authored-by,valueonly,
    separator=%x1f)` output: zero or more "Name <email>" entries
    joined by `\\x1f`. Empty string when the commit has no
    Co-authored-by trailers.

    Per-commit dedup is on the name string only — matches the primary
    author format (no email) and `colorForAuthor` keying. If a trailer
    has only an email (`<bot@host>` with no name), the email's
    local-part (the substring before `@`) is used as the identity so
    the public authors list honors CommitEntry's "emails stripped"
    guarantee.
    """
    seen = {primary}
    out: list[str] = [primary]
    if not trailers_raw:
        return out
    for raw in trailers_raw.split("\x1f"):
        m = _NAME_EMAIL.match(raw)
        if m:
            name = m.group(1).strip()
            if not name:
                # Email-only trailer: keep only the local-part to avoid
                # leaking the @domain into the public authors field.
                name = m.group(2).strip().split("@", 1)[0]
        else:
            name = raw.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


def _collect_git_dates(
    root: Path, ref: str | None = None
) -> tuple[dict[str, str], dict[str, str], list[CommitEntry]]:
    """One newest→oldest `git log --name-status` walk that populates
    both created_map and modified_map in a single pass, and also
    accumulates a per-commit (date, files, sha) summary list.

    Replaces two parallel walks (`--diff-filter=A --reverse` for creates
    + bare walk for modifies). Halves the subprocess count — we read
    the same history from one process, parsing both A-events and
    other-status events as we go.

    --no-renames means a rename is recorded as delete+add, so the
    `created` date reflects when the *current path* first appeared.
    For an age signal this is the right semantic (the user sees a
    building for the path, not for a file-identity).

    Walk direction is newest→oldest with first-sighting-wins, so:
      - modified[path] = date of the most recent commit touching path
      - created[path]  = date of the most recent `A`-status event for
        path. For files added once and never re-added, this is the
        true creation date.
    """
    _log("  starting git log walk (full history)…")
    # See _run_git docstring for why -c safe.directory=* is needed.
    log_argv = [
        "git",
        "-c",
        "safe.directory=*",
        "-C",
        str(root),
        "log",
        "--format=COMMIT:%aI%x09%P%x09%H%x09%an%x09"
        "%(trailers:key=Co-authored-by,valueonly,separator=%x1f)"
        "%x09%s",
        "--name-status",
        "--no-renames",
        # Merges diffed so a merge commit still reports a file count; their
        # A/M events are skipped when writing the date maps (see the parse).
        "--diff-merges=first-parent",
    ]
    if ref is not None:
        log_argv.append(ref)  # a resolved sha; limits the walk to its ancestors
    try:
        proc = subprocess.Popen(
            log_argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            # Old commits (e.g. torvalds/linux) carry Latin-1 author/subject
            # bytes that aren't valid UTF-8. Default strict decoding raises
            # mid-stream, exits this loop, and the finally below then
            # deadlocks on proc.wait() because git still has output to
            # write. Replace decode errors so the walk completes.
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except FileNotFoundError:
        return {}, {}, []

    created: dict[str, str] = {}
    modified: dict[str, str] = {}
    commits_newest_first: list[CommitEntry] = []
    # Always UTC (Z-suffixed), normalized once per COMMIT line — the per-file
    # date maps, commit entries, and same-day buckets all share one zone.
    current_date = ""
    current_is_merge = False
    current_sha = ""
    current_author = ""
    current_trailers = ""
    current_subject = ""
    current_files = 0
    commits = 0
    heartbeat_every = 25_000
    assert proc.stdout is not None
    # try/finally so an exception escaping the parse loop (MemoryError,
    # KeyboardInterrupt, etc.) doesn't leave the git subprocess running
    # as a zombie. Must kill before wait — if git is mid-write with a
    # full stdout pipe (we stopped reading), wait() alone deadlocks
    # because git can't exit until the pipe drains.
    try:
        for line in proc.stdout:
            line = line.rstrip("\n")
            if not line:
                continue
            if line.startswith("COMMIT:"):
                # Flush the previous commit (if any) before starting the next.
                if current_date:
                    commits_newest_first.append(
                        {
                            "date": current_date,
                            "files": current_files,
                            "sha": current_sha,
                            "authors": build_authors_list(
                                current_author, current_trailers
                            ),
                            "subject": current_subject,
                        }
                    )
                rest = line[len("COMMIT:") :]
                # %aI%x09%P%x09%H%x09%an%x09<trailers>%x09%s — maxsplit=5 keeps
                # tabs in the subject. %P is space-separated parents.
                parts = rest.split("\t", 5)
                current_date = _git_iso_to_utc(parts[0])
                current_is_merge = " " in (parts[1] if len(parts) > 1 else "")
                current_sha = parts[2] if len(parts) > 2 else ""
                current_author = parts[3] if len(parts) > 3 else ""
                current_trailers = parts[4] if len(parts) > 4 else ""
                current_subject = parts[5] if len(parts) > 5 else ""
                current_files = 0
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
            path = line[tab_idx + 1 :]
            current_files += 1
            # A subtree merge re-adds its files; don't let the merge date
            # overwrite each file's real creation/modification.
            if current_is_merge:
                continue
            if path not in modified:
                modified[path] = current_date
            if status.startswith("A") and path not in created:
                created[path] = current_date
        # Flush the final commit (the loop exits after the last block, not after a COMMIT line).
        if current_date:
            commits_newest_first.append(
                {
                    "date": current_date,
                    "files": current_files,
                    "sha": current_sha,
                    "authors": build_authors_list(current_author, current_trailers),
                    "subject": current_subject,
                }
            )
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    _log(
        f"  done — {commits:,} commits in window, "
        f"{len(modified):,} files touched, "
        f"{len(created):,} with creation event"
    )
    # Reverse to oldest-first so manifest consumers can use index = age rank.
    commits_oldest_first: list[CommitEntry] = list(reversed(commits_newest_first))
    return created, modified, commits_oldest_first


def _collect_git_history(
    root: Path,
    *,
    use_cache: bool = True,
    ref: str | None = None,
) -> tuple[dict[str, str], dict[str, str], list[CommitEntry]]:
    """Return (created_map, modified_map, commits).

    - created_map[path]  = ISO date of most recent ``A``-event for path
                           across the walked history. Files never
                           added are absent.
    - modified_map[path] = ISO date of most recent commit touching the
                           path. Untouched files are absent.
    - commits            = oldest-first list of CommitEntry (date, files, sha)
                           for each commit in the walked history.

    Single `git log --name-status --no-renames` walk populates both
    maps in one pass. With ``use_cache=True`` (default), the cache
    short-circuits the walk when the key hasn't moved.

    ``ref``, when given, must already be a resolved sha (immutable) —
    the walk starts there instead of HEAD, and the cache keys on it
    directly rather than re-resolving HEAD each call.
    """
    key_sha = ref if ref is not None else _run_git(root, "rev-parse", "HEAD").strip()
    if use_cache and key_sha:
        cached = cache_load_git_history(root, key_sha)
        if cached is not None:
            created, modified, commits = cached
            return created, modified, commits

    _log("  collecting creation + modified dates…")
    created, modified, commits = _collect_git_dates(root, ref)
    _log(
        f"    {len(created)} created, {len(modified)} modified, {len(commits)} commits"
    )

    # Always write the cache (only `key_sha` is required to key it) —
    # `use_cache` gates the READ above, not the write. A skip-cache scan
    # still refreshes the cache so the next normal run is up to date.
    if key_sha:
        try:
            cache_save_git_history(root, key_sha, created, modified, commits)
        except OSError:
            # Cache failures (disk full, permission denied, read-only fs)
            # must never block a scan. The next run will retry the write.
            pass

    return created, modified, commits


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
        host_path = s[len("git@") :]
        host, _, path = host_path.partition(":")
        if not host or not path:
            return ""
        s = f"https://{host}/{path}"
    if s.endswith(".git"):
        s = s[: -len(".git")]
    if not (s.startswith("http://") or s.startswith("https://")):
        return ""
    return s


def _parse_dirty_paths(porcelain_z: str) -> set[str]:
    """Repo-relative paths whose working tree differs from HEAD, parsed from
    `git status --porcelain -z`. Excludes untracked (`??`) and ignored (`!!`);
    for a rename/copy entry (`R`/`C` in either the index or worktree status
    char) the destination path is the dirty one and the following
    NUL-separated field (the source) is skipped."""
    fields = [f for f in porcelain_z.split("\0") if f]
    dirty: set[str] = set()
    i = 0
    while i < len(fields):
        entry = fields[i]
        i += 1
        # Porcelain entry: two status chars, a space, then the path.
        status, path = entry[:2], entry[3:]
        if status in ("??", "!!"):
            continue
        # Rename/copy (index-side R/C or worktree-side R/C): the NEXT field
        # is the source path — consume + ignore it.
        if "R" in status or "C" in status:
            i += 1
        if path:
            dirty.add(path)
    return dirty


def _collect_dirty_paths(root: Path) -> set[str]:
    """Fresh (never cached — dirty changes without HEAD moving) set of dirty
    tracked paths from a single porcelain call."""
    return _parse_dirty_paths(_run_git(root, "status", "--porcelain", "-z"))


def _collect_repo_info(root: Path) -> tuple[RepoInfo, set[str]]:
    """Repo-level git metadata for the manifest's `repo` field, plus the
    dirty-path set the caller needs to thread into the tree walk.

    Cheap-ish: one rev-parse, one symbolic-ref, one config read, one
    log -1, and one porcelain status. The status walk dominates on
    large dirty trees, so it's collected here ONCE and returned
    alongside `info` rather than re-run by callers that also need the
    per-path set (`repo.dirty` is just `bool(dirty_paths)`).
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
    else:
        # Unborn HEAD (rev-parse exited non-zero → empty stdout): the
        # repo has no commits yet, but HEAD still resolves as a symbolic
        # ref to the configured default branch (e.g. "main"). Surface
        # that name so the frontend can show "this is an empty <branch>"
        # instead of falling back to "detached HEAD".
        symref = _run_git(root, "symbolic-ref", "--short", "HEAD").strip()
        if symref:
            info["branch"] = symref

    remote = _run_git(root, "config", "--get", "remote.origin.url").strip()
    info["remote_url"] = _normalize_remote_to_web_url(remote) or None

    head_line = _run_git(root, "log", "-1", "--format=%h%x09%s").strip()
    if head_line:
        sha, _, subject = head_line.partition("\t")
        info["head_sha"] = sha or None
        info["head_subject"] = subject or None

    dirty_paths = _collect_dirty_paths(root)
    info["dirty"] = bool(dirty_paths)

    return info, dirty_paths


def _tracked_set(root: Path) -> set[str]:
    """Just the tracked-files set from `git ls-files` (no per-file history).

    Cheaper subset of _collect_git_history for callers that only need
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


class GitState(NamedTuple):
    """One always-fresh snapshot of the index/working tree: the repo footer
    fields, the tracked-path set (gitignore filter), and the dirty-path set.
    Never cached — all three change without HEAD moving."""

    repo: RepoInfo
    tracked: set[str]
    dirty: set[str]


def _collect_git_state(root: Path) -> GitState:
    repo, dirty = _collect_repo_info(root)  # branch/remote/head/dirty + dirty set
    tracked = _tracked_set(root)
    return GitState(repo=repo, tracked=tracked, dirty=dirty)


# ── Skip list ────────────────────────────────────────────────────────────────

# Names (directories or files) that get skipped on every scan. Most of
# these are already filtered out by the tracked-files filter (they're
# gitignored), but listing them here keeps explicitly-tracked noise
# (e.g. someone who committed node_modules/ or a generated lockfile)
# from blowing up the city.
#
# We deliberately do NOT include generic names like "dist", "build", "out".
# Those collide with legitimate source directories in real projects (CMake
# build configs, audio "out" stems, hand-written `dist/` source trees).
# Framework-specific build dirs (.next, .nuxt, etc.) are unambiguous and
# stay in the list. Lockfile names are listed verbatim — they're all
# unambiguous and auto-generated, and including them blows out the city
# with thousand-line files that aren't really code.
#
# Per-project additions go in `<scan-root>/.codecityignore` (see
# _load_codecityignore). The skip list is always applied — there's no
# runtime escape hatch beyond editing this file or .codecityignore
# (e.g. `!package-lock.json` to surface a specific lockfile).
ALWAYS_SKIP: frozenset[str] = frozenset(
    {
        ".git",
        ".hg",
        ".svn",  # VCS
        "node_modules",  # JS
        ".venv",
        "venv",
        "env",
        "__pycache__",  # Python
        "target",
        ".cargo",  # Rust
        ".next",
        ".nuxt",
        ".svelte-kit",  # framework caches
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".tox",
        ".coverage",
        "htmlcov",  # test/coverage
        ".idea",
        ".vscode",  # IDE state
        ".DS_Store",  # macOS junk
        # Lockfiles — auto-generated, line-heavy, not meaningful as "code".
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",  # JS
        "bun.lock",
        "bun.lockb",  # Bun
        "deno.lock",  # Deno
        "Cargo.lock",  # Rust
        "poetry.lock",
        "uv.lock",
        "Pipfile.lock",  # Python
        "composer.lock",  # PHP
        "Gemfile.lock",  # Ruby
        "mix.lock",  # Elixir
        "Podfile.lock",  # CocoaPods
        "flake.lock",  # Nix
        "Gopkg.lock",
        "go.sum",  # Go
        # Generated artifacts — machine-produced metadata, not authored code.
        "sbom.json",  # CycloneDX / SPDX software bill of materials
        # Vendored single-file amalgamations — one giant .c file (often
        # 100k+ lines) that's the entire library inlined. Like lockfiles,
        # they're boilerplate from upstream rather than meaningful "code" —
        # one such file becomes a 250k-line skyscraper that dominates every
        # height-based visual. Public headers (sqlite3.h, miniz.h, lua.h)
        # are NOT skipped: they're moderate-size and may be authored code.
        "sqlite3.c",  # SQLite amalgamation
        "miniz.c",  # miniz amalgamation
        "lua.c",  # Lua amalgamation
    }
)


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
    3. ``ALWAYS_SKIP`` (hardcoded global noise names — dirs + lockfiles).
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


def _tracked_entries(
    abs_dir: str,
    rel_dir: str,
    *,
    tracked_files: set[str],
    ignore_names: frozenset[str],
    ignore_paths: frozenset[str],
    unignore_names: frozenset[str],
    unignore_paths: frozenset[str],
) -> list[tuple[os.DirEntry[str], str]]:
    """Sorted-scandir survivors of one directory: skip-list + tracked filter
    applied, each paired with its repo-relative path. The single source of
    'which entries, in what order' shared by _build_tree and _walk_for_signature
    — the contract that keeps their signatures byte-identical."""
    try:
        entries = sorted(os.scandir(abs_dir), key=lambda e: e.name)
    except OSError:
        return []
    out: list[tuple[os.DirEntry[str], str]] = []
    for entry in entries:
        entry_rel = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"
        if _should_skip(
            entry.name,
            entry_rel,
            ignore_names=ignore_names,
            ignore_paths=ignore_paths,
            unignore_names=unignore_names,
            unignore_paths=unignore_paths,
        ):
            continue
        if entry_rel not in tracked_files:
            continue
        out.append((entry, entry_rel))
    return out


# Both scan_tree and signature_tree feed bytes into the same hash; keeping
# the per-file and per-repo contributions in dedicated helpers is the
# contract that lets the cheap signature endpoint match the full scan's
# signature exactly. Don't inline these — drift here breaks live updates.
def _hash_file_entry(
    sig: Any, rel_path: str, size: int, mtime: float, is_dirty: bool
) -> None:
    sig.update(rel_path.encode("utf-8"))
    sig.update(b"\0")
    sig.update(str(size).encode("ascii"))
    sig.update(b"\0")
    sig.update(repr(mtime).encode("ascii"))
    sig.update(b"\0")
    # Dirty rides with each file: a mode-only edit flips it without moving
    # size/mtime, and a cached manifest would otherwise serve a stale flag.
    sig.update(b"1" if is_dirty else b"0")
    sig.update(b"\0")


def _hash_repo_info(sig: Any, repo_info: RepoInfo) -> None:
    sig.update(
        (
            f"{repo_info['branch']}|{repo_info['remote_url']}|"
            f"{repo_info['head_sha']}|{repo_info['dirty']}"
        ).encode("utf-8")
    )


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
    """The one place a FileNode dict is assembled. All three build paths — live
    scan skeleton, single-ref reconstruction, timeline union — go through here so
    a new field is added once and no path can silently omit it (a hardcoded
    `binary: False` in one copy is what left binaries un-rendered in Timeline).
    Callers resolve the field VALUES their own way (filesystem stat vs blob
    stats); this fixes the SHAPE."""
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


def _file_node(
    entry: os.DirEntry[str],
    rel_path: str,
    git_created: dict[str, str],
    git_modified: dict[str, str],
    dirty_paths: set[str],
    sig: Any,
) -> FileNode:
    """Live-scan FileNode skeleton — `lines`/`binary` (and media dims /
    binaryType) are placeholders filled in by _populate_file_metadata after the
    walk, so content I/O batches once instead of per-node."""
    size, fs_created, fs_modified, mtime = _stat_fields(entry)
    is_dirty = rel_path in dirty_paths
    _hash_file_entry(sig, rel_path, size, mtime, is_dirty)
    # git history date, or the fs date when the file has no history entry
    # (a tracked file that's never been committed).
    created = git_created.get(rel_path) or fs_created
    # A dirty file's last-commit date is stale, so use the working-tree mtime.
    modified = fs_modified if is_dirty else (git_modified.get(rel_path) or fs_modified)
    return build_file_node(
        name=entry.name,
        rel_path=rel_path,
        full_path=entry.path,
        ext=_extension(entry.name),
        size=size,
        lines=0,
        binary=False,
        dirty=is_dirty,
        created=created,
        modified=modified,
    )


# Worker pool size for parallel file content reads. Capped at 32 to
# avoid pool-construction overhead on machines with very high cpu_count;
# doubling cpu_count gives oversubscription that helps when threads
# block on read().
_FILE_IO_POOL_SIZE = min(32, (os.cpu_count() or 1) * 2)


def _read_file_metadata(
    path_obj: Path,
) -> tuple[bool, int, int | None, int | None, str | None]:
    """Return (binary, lines, media_width, media_height, binary_type) for one
    file. Worker function for _populate_file_metadata's thread pool. Media dims
    are None for non-media files or files the probe can't read; binary_type is
    the friendly magic-byte type, set only for recognized binary files."""
    binary = _is_binary(path_obj)
    lines = 0 if binary else _line_count(path_obj)
    mw, mh = probe_media_dims(path_obj)
    binary_type = _detect_binary_type(path_obj) if binary else None
    return binary, lines, mw, mh, binary_type


def _detect_binary_type(path_obj: Path) -> str | None:
    """Friendly magic-byte type for a binary file, or None. Reads only the
    leading bytes (enough for every signature); silent on read failure."""
    try:
        with path_obj.open("rb") as fh:
            head = fh.read(64)
    except OSError:
        return None
    return detect_binary_type(head)


def _node_mtime(node: FileNode) -> float:
    """Recover the float mtime for a FileNode by stat-ing fullPath.
    The node's `modified` field is an ISO string (lossy for cache
    comparison); the raw mtime feeds the cache directly."""
    try:
        return Path(node["fullPath"]).stat().st_mtime
    except OSError:
        return 0.0


def _populate_file_metadata(
    tree: DirNode,
    abs_root: Path,
    *,
    use_cache: bool,
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
            bt = cached.get("binaryType")
            if bt is not None:
                node["binaryType"] = bt
            continue
        miss_indices.append(i)
        miss_paths.append(Path(node["fullPath"]))

    total = len(nodes)
    hits = total - len(miss_paths)
    _log(
        f"  populating metadata: {total} files ({hits} cache hits, {len(miss_paths)} to read)"
    )

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
                    binary, lines, mw, mh, binary_type = fut.result()
                    nodes[idx]["binary"] = binary
                    nodes[idx]["lines"] = lines
                    if mw is not None and mh is not None:
                        nodes[idx]["media_width"] = mw
                        nodes[idx]["media_height"] = mh
                    if binary_type is not None:
                        nodes[idx]["binaryType"] = binary_type
                    done += 1
                    if done % heartbeat_step == 0:
                        _log(f"    read {done}/{len(miss_paths)} files…")
            except ScanCancelledError:
                pool.shutdown(wait=False)
                raise
        _log(f"    read {len(miss_paths)}/{len(miss_paths)} files")

    # Always write the file-stat cache — `use_cache` gates only the READ.
    # On a warm scan cache_entries holds the loaded cache, so this is a
    # union-merge (preserves entries for files not visited this scan, e.g.
    # when .codecityignore flips); on a skip-cache scan it starts empty and
    # records exactly the files this fresh scan visited.
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
        if "binaryType" in node:
            entry["binaryType"] = node["binaryType"]
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


# Match clone.py: 250ms is short enough to feel live, long enough to
# coalesce the high-frequency tick() calls during a fast tree walk
# (where tick() fires once per file — easily thousands/sec on warm
# fs cache).
SCAN_PROGRESS_THROTTLE_S = 0.25


class _Heartbeat:
    """Per-scan file-count tracker. Was a module-level global; that race-
    bombed under ThreadingHTTPServer because two concurrent /api/manifest
    requests would share + mutate the same counter, garbling progress
    output and corrupting the running tally.

    If ``on_progress`` is supplied, the heartbeat calls it with the
    current ``seen`` count at most once per ~250ms (independently of
    the every-100-files log line above). Server-side this becomes one
    ``scanning`` NDJSON event per call."""

    __slots__ = ("seen", "_on_progress", "_last_emit", "_last_emitted_count")

    def __init__(
        self,
        on_progress: Callable[[int], None] | None = None,
    ) -> None:
        self.seen = 0
        self._on_progress = on_progress
        self._last_emit = 0.0
        self._last_emitted_count = -1  # -1 = never emitted

    def tick(self) -> None:
        self.seen += 1
        if self.seen % 100 == 0:
            _log(f"  walked {self.seen} files so far…")
        if self._on_progress is None:
            return
        now = time.monotonic()
        if now - self._last_emit < SCAN_PROGRESS_THROTTLE_S:
            return
        self._on_progress(self.seen)
        self._last_emit = now
        self._last_emitted_count = self.seen

    def flush(self) -> None:
        """Emit the final count if it hasn't been emitted yet. Called
        when the walk finishes so the UI sees the true file total even
        if the last few ticks were throttled."""
        if self._on_progress is None:
            return
        if self.seen != self._last_emitted_count:
            self._on_progress(self.seen)
            self._last_emitted_count = self.seen


class _DirFrame:
    """One pending directory in the iterative tree walk.

    Iterative because recursion blows past sys.setrecursionlimit (1000
    by default) on deeply nested trees — Java package hierarchies,
    generated protobuf trees, monorepos. Stack-based DFS is bounded by
    available heap, not the C stack."""

    __slots__ = (
        "rel_dir",
        "name",
        "full_path",
        "pending_entries",
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
        pending_entries: list[tuple[str, str, bool]],
    ) -> None:
        self.rel_dir = rel_dir
        self.name = name
        self.full_path = full_path
        # Order (and the skip/tracked filter) comes from the injected
        # list_children — the same order signature-hash stability depends on,
        # shared with _walk_for_signature so scan-to-scan and endpoint
        # fingerprints match.
        self.pending_entries = pending_entries
        self.files: list[FileNode] = []
        self.subdirs: list[DirNode] = []
        self.descendants_count = 0
        self.descendants_file_count = 0
        self.descendants_dir_count = 0
        self.descendants_size = 0
        # Oldest created / newest modified date over all descendant files (ISO
        # strings, lexically comparable). None until the first file is seen.
        self.descendants_created_min: str | None = None
        self.descendants_modified_max: str | None = None
        # ext (lowercase, None for extensionless files) -> [count, total_size],
        # over all descendant files. Merged up from child frames as they pop.
        self.ext_breakdown: dict[str | None, list[int]] = {}


def _build_tree(
    root_abs: str,
    rel_root: str,
    *,
    list_children: Callable[[str], list[tuple[str, str, bool]]],
    make_file_node: Callable[[str, str], FileNode],
) -> DirNode:
    """Iterative DFS tree builder shared by the live scan and the
    time-travel reconstruction. Its two filesystem touch-points are
    injected so a git-object reconstruction can feed the identical
    frame/rollup/ordering loop:

    - ``list_children(rel_dir)`` — sorted ``(name, rel_path, is_dir)``
      survivors of the skip/tracked filter for one directory (files and
      dirs only; entries that are neither are pre-filtered by the caller).
    - ``make_file_node(name, rel_path)`` — build the leaf FileNode and
      push its bytes into the content hash (the injector owns the sig +
      heartbeat).

    ``[*files, *subdirs]`` child order and the ext-breakdown sort are the
    contract the layout packer + signature hashes depend on, so both
    callers get byte-identical structure/layout signatures."""

    def _dir_full_path(rel_dir: str) -> str:
        return root_abs if rel_dir == rel_root else f"{root_abs}/{rel_dir}"

    def _frame(rel_dir: str, name: str) -> _DirFrame:
        return _DirFrame(rel_dir, name, _dir_full_path(rel_dir), list_children(rel_dir))

    stack: list[_DirFrame] = [_frame(rel_root, os.path.basename(root_abs))]

    while True:
        top = stack[-1]
        if top.pending_entries:
            # Process the next entry in sorted order. Entries are popped
            # from the front (not back) so the iteration order matches
            # the original recursive code's — required for hash stability.
            name, entry_rel, is_dir = top.pending_entries.pop(0)

            if is_dir:
                # Descend by pushing a new frame; rollup happens when it
                # pops below.
                stack.append(_frame(entry_rel, name))
            else:
                node = make_file_node(name, entry_rel)
                top.files.append(node)
                top.descendants_count += 1
                top.descendants_file_count += 1
                top.descendants_size += node["size"]
                top.descendants_created_min = min_iso(
                    top.descendants_created_min, node["created"]
                )
                top.descendants_modified_max = max_iso(
                    top.descendants_modified_max, node["modified"]
                )
                raw_ext = node["extension"]
                ext = raw_ext.lower() if raw_ext else None
                bucket = top.ext_breakdown.get(ext)
                if bucket is None:
                    top.ext_breakdown[ext] = [1, node["size"]]
                else:
                    bucket[0] += 1
                    bucket[1] += node["size"]
            continue

        # All entries processed — finalize this frame and either return it
        # (root) or attach to the parent.
        finished = stack.pop()
        children: list[FileNode | DirNode] = [*finished.files, *finished.subdirs]
        # Sort by count desc, then ext asc for deterministic output; the
        # extensionless (None) bucket sorts last within its count tier.
        ext_breakdown_out: list[ExtBreakdownEntry] = [
            {"ext": ext, "count": cnt, "size": size}
            for ext, (cnt, size) in sorted(
                finished.ext_breakdown.items(),
                key=lambda kv: (-kv[1][0], kv[0] is None, kv[0] or ""),
            )
        ]
        node_out: DirNode = {
            "name": finished.name,
            "type": NodeKind.DIRECTORY,
            "path": finished.rel_dir,
            "fullPath": finished.full_path,
            "children_count": len(children),
            "children_file_count": len(finished.files),
            "children_dir_count": len(finished.subdirs),
            "descendants_count": finished.descendants_count,
            "descendants_file_count": finished.descendants_file_count,
            "descendants_dir_count": finished.descendants_dir_count,
            "descendants_size": finished.descendants_size,
            "descendants_created_min": finished.descendants_created_min,
            "descendants_modified_max": finished.descendants_modified_max,
            "descendants_ext_breakdown": ext_breakdown_out,
            "children": children,
        }
        if not stack:
            return node_out
        parent = stack[-1]
        parent.subdirs.append(node_out)
        parent.descendants_count += 1 + node_out["descendants_count"]
        parent.descendants_file_count += node_out["descendants_file_count"]
        parent.descendants_dir_count += 1 + node_out["descendants_dir_count"]
        parent.descendants_size += node_out["descendants_size"]
        parent.descendants_created_min = min_iso(
            parent.descendants_created_min, node_out["descendants_created_min"]
        )
        parent.descendants_modified_max = max_iso(
            parent.descendants_modified_max, node_out["descendants_modified_max"]
        )
        # Merge the child's per-extension breakdown up into the parent.
        for ext, (cnt, size) in finished.ext_breakdown.items():
            bucket = parent.ext_breakdown.get(ext)
            if bucket is None:
                parent.ext_breakdown[ext] = [cnt, size]
            else:
                bucket[0] += cnt
                bucket[1] += size


# ── Public entry ─────────────────────────────────────────────────────────────


class TreeSignals(NamedTuple):
    structure_signature: str
    layout_signature: str
    date_ranges: DateRanges


def _derive_tree_signals(tree_root: DirNode) -> TreeSignals:
    """Single pass over the built (pre-populate) tree producing every signal that
    depends only on structure + build-time metadata:

    - structure_signature  — structure only (paths + nesting); drives the icon-atlas
      gate + skeleton/final stability. Ignores size/dates.
    - layout_signature — structure + per-file byte size (the layout packer's
      inputs: footprints + street length). Between structure_signature (too coarse)
      and content_signature (too fine — includes mtime). The frontend
      reuses the packed layout iff this is unchanged. Each node's bytes are
      prefixed with a one-byte type marker (d/f) so a file's size token can
      never be misread as a sibling's path token.
    - date_ranges     — repo-wide min/max of resolved created/modified.

    All inputs are real in the pre-populate tree, so the values are identical for
    the skeleton and final manifests of a scan. Children sorted by path for
    determinism (no-op when _build_tree already sorts)."""
    struct = hashlib.blake2b(digest_size=8)
    layout = hashlib.blake2b(digest_size=8)
    cmin = cmax = mmin = mmax = None

    def _walk(node: TreeNode) -> None:
        nonlocal cmin, cmax, mmin, mmax
        struct.update(node["path"].encode("utf-8"))
        struct.update(b"\x00")
        layout.update(b"d" if node["type"] == NodeKind.DIRECTORY else b"f")
        layout.update(node["path"].encode("utf-8"))
        layout.update(b"\x00")
        if node["type"] == NodeKind.DIRECTORY:
            for c in sorted(node["children"], key=lambda n: n["path"]):
                _walk(c)
        else:
            layout.update(str(node["size"]).encode("ascii"))
            layout.update(b"\x00")
            cr, md = node["created"], node["modified"]
            cmin = cr if cmin is None or cr < cmin else cmin
            cmax = cr if cmax is None or cr > cmax else cmax
            mmin = md if mmin is None or md < mmin else mmin
            mmax = md if mmax is None or md > mmax else mmax

    _walk(tree_root)
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


def _compute_busyness(commits: list[CommitEntry]) -> BusynessThresholds:
    """Repo-relative per-day commit-count thresholds. avg = median commits/day
    (over days with >= 1 commit); busy = 75th percentile, clamped to avg+1 so
    the three bands stay distinct. Both the scene tree-color gradient and the
    commit pane's label read these, so a busy day looks consistent in both.
    Returns {avg:1, busy:1} for an empty history so consumers needn't guard."""
    if not commits:
        return {"avg": 1, "busy": 1}
    per_day: dict[str, int] = {}
    for c in commits:
        per_day[_day_key(c)] = per_day.get(_day_key(c), 0) + 1
    counts = sorted(per_day.values())

    def _quantile(p: float) -> int:
        return counts[min(len(counts) - 1, int(len(counts) * p))]

    avg = _quantile(0.5)
    busy = max(_quantile(0.75), avg + 1)
    return {"avg": avg, "busy": busy}


def _wrap_manifest(
    root_abs: str,
    tree: DirNode,
    sig: Any,
    signals: TreeSignals,
    repo_info: RepoInfo,
    commits: list[CommitEntry],
) -> Manifest:
    """Build a Manifest envelope around an already-built tree.

    Skeleton vs final differ only in the `tree` they pass in (skeleton
    has placeholder lines/binary set by _force_skeleton_placeholders;
    final has the real per-file metadata). The envelope shape is the
    same either way."""
    _annotate_same_day_totals(commits)
    # Canonical repo display name, set once at manifest creation and cached with
    # it: prefer the git remote's "owner/repo" over the on-disk root basename (a
    # clone's cache-dir hash, or a worktree's folder name). This is THE name every
    # consumer reads via tree.name — no downstream recomputation.
    # Local import: source.py -> clone.py -> scan.py would cycle at module load.
    from api.services.source import label_from_source

    tree["name"] = label_from_source(repo_info["remote_url"]) or tree["name"]
    return {
        "root": root_abs,
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "content_signature": sig.hexdigest(),
        "structure_signature": signals.structure_signature,
        "layout_signature": signals.layout_signature,
        "tree": tree,
        "repo": repo_info,
        "commits": commits,
        "busyness": _compute_busyness(commits),
        "dateRanges": signals.date_ranges,
        "stats": compute_repo_stats(tree, commits),
    }


def _annotate_same_day_totals(commits: list[CommitEntry]) -> None:
    """In-place: set each commit's same_day_total to the number of commits
    sharing its calendar date. A derived aggregate (like busyness), so it's
    baked at wrap time rather than during git collection — both the commit
    pane's badge and the scene tree-color read this one field (#35)."""
    per_day: dict[str, int] = {}
    for c in commits:
        per_day[_day_key(c)] = per_day.get(_day_key(c), 0) + 1
    for c in commits:
        c["same_day_total"] = per_day[_day_key(c)]


def _force_skeleton_placeholders(node: DirNode | FileNode) -> None:
    """In-place: set every FileNode under `node` to lines=1, binary=False
    so the skeleton renders with uniform-height buildings."""
    if node["type"] == NodeKind.FILE:
        node["lines"] = 1  # type: ignore[typeddict-item]
        node["binary"] = False  # type: ignore[typeddict-item]
        return
    for child in node.get("children", []):  # type: ignore[union-attr]
        _force_skeleton_placeholders(child)


def scan_tree(
    root: str,
    *,
    use_cache: bool = True,
    cancel_event: "threading.Event | None" = None,
    on_scan_progress: Callable[[int], None] | None = None,
    extra_exclude_paths: frozenset[str] = frozenset(),
) -> Iterator["ScanStreamEvent"]:
    """Scan a git working tree and yield manifest events.

    Yields a "manifest-partial" event after the tree walk (placeholder
    file metadata so the UI can paint immediately), then a
    "manifest-complete" event after per-file metadata is populated.

    The scanner walks only paths in ``git ls-files`` — gitignored and
    untracked files are hidden. Raises ``NotAGitRepoError`` if ``root``
    isn't inside a git working tree. The server enforces this at the
    HTTP boundary; the check here is defense-in-depth.

    The skip list (ALWAYS_SKIP plus the optional ``<root>/.codecityignore``)
    is always applied on top of the tracked-files filter — handy for
    hiding committed noise like ``node_modules/`` or vendor bundles.
    Per-project additions go in ``<root>/.codecityignore`` (one literal
    name per line, or relative paths containing ``/``).

    ``extra_exclude_paths`` — extra rel-paths skipped in addition to
    ``.codecityignore``, supplied by the UI."""
    root_abs = str(Path(root).resolve())
    _log(f"resolving {root_abs}")

    if not _is_git_repo(Path(root_abs)):
        raise NotAGitRepoError(root_abs)

    _check_cancel(cancel_event)  # before _collect_git_history

    _log("collecting git metadata…")
    git_created, git_modified, commits_list = _collect_git_history(
        Path(root_abs),
        use_cache=use_cache,
    )
    git = _collect_git_state(Path(root_abs))

    _check_cancel(cancel_event)  # after git metadata, before tree walk

    ignore_names, ignore_paths, unignore_names, unignore_paths = _load_codecityignore(
        Path(root_abs)
    )
    # UI excludes are additive rel-path skips on top of .codecityignore. They
    # feed ignore_paths so _should_skip's existing precedence (negation,
    # ALWAYS_SKIP, then ignores) holds — a UI exclude can't resurrect a default.
    if extra_exclude_paths:
        ignore_paths = ignore_paths | extra_exclude_paths

    heartbeat = _Heartbeat(on_progress=on_scan_progress)
    _log("walking tree…")
    sig = hashlib.blake2b(digest_size=16)

    # Live FS adapters for the shared _build_tree. list_children keeps the
    # scandir survivors + their order; make_file_node reuses the real
    # os.DirEntry (threaded via entry_by_rel) so _file_node's stat/hash is
    # byte-for-byte what it was before the callable seam.
    entry_by_rel: dict[str, os.DirEntry[str]] = {}

    def _live_list_children(rel_dir: str) -> list[tuple[str, str, bool]]:
        abs_dir = root_abs if rel_dir == "." else f"{root_abs}/{rel_dir}"
        out: list[tuple[str, str, bool]] = []
        for entry, entry_rel in _tracked_entries(
            abs_dir,
            rel_dir,
            tracked_files=git.tracked,
            ignore_names=ignore_names,
            ignore_paths=ignore_paths,
            unignore_names=unignore_names,
            unignore_paths=unignore_paths,
        ):
            is_dir = entry.is_dir(follow_symlinks=False)
            # Preserve the old file/dir gate: an entry that is neither (a
            # dangling symlink, socket, fifo) fell through both branches and
            # was never noded. Drop it here so is_dir alone drives the loop.
            if not is_dir and not entry.is_file(follow_symlinks=False):
                continue
            if not is_dir:
                entry_by_rel[entry_rel] = entry
            out.append((entry.name, entry_rel, is_dir))
        return out

    def _live_make_file_node(name: str, rel_path: str) -> FileNode:
        entry = entry_by_rel.pop(rel_path)
        node = _file_node(entry, rel_path, git_created, git_modified, git.dirty, sig)
        heartbeat.tick()
        return node

    tree = _build_tree(
        root_abs,
        ".",
        list_children=_live_list_children,
        make_file_node=_live_make_file_node,
    )
    heartbeat.flush()  # ensure UI sees the true final count, not whatever the throttle last allowed through
    _log(f"walked {heartbeat.seen} files; emitting skeleton")

    # Derive structure_signature/layout_signature/dateRanges once after the tree is
    # built, from the real pre-populate metadata (structure + size + dates, NO
    # mtime), so they are identical for skeleton and final manifests of the
    # same scan.
    signals = _derive_tree_signals(tree)

    _check_cancel(cancel_event)  # after tree walk, before skeleton emit

    # We deep-copy here so the skeleton's placeholder-mutation doesn't
    # affect the tree that _populate_file_metadata is about to modify
    # in-place. Cheap for small repos; for Linux this is ~50ms.
    skeleton_tree = copy.deepcopy(tree)
    _force_skeleton_placeholders(skeleton_tree)
    yield {
        "phase": ScanEvent.MANIFEST_PARTIAL,
        "manifest": _wrap_manifest(
            root_abs,
            skeleton_tree,
            sig,
            signals,
            git.repo,
            commits_list,
        ),
    }

    _log("resolving file metadata")
    _populate_file_metadata(
        tree,
        Path(root_abs),
        use_cache=use_cache,
        cancel_event=cancel_event,
    )
    _check_cancel(cancel_event)  # after populate, before final emit
    _log("emitting final manifest")

    # Repo-level metadata — branch, remote, head, dirty — feeds the
    # signature so the footer's "live" indicator catches a checkout or
    # commit without waiting for file mtimes to shift.
    _hash_repo_info(sig, git.repo)

    yield {
        "phase": ScanEvent.MANIFEST_COMPLETE,
        "manifest": _wrap_manifest(
            root_abs,
            tree,
            sig,
            signals,
            git.repo,
            commits_list,
        ),
    }


def _walk_for_signature(
    abs_dir: str,
    rel_dir: str,
    *,
    tracked_files: set[str],
    dirty_paths: set[str],
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
    entries = _tracked_entries(
        abs_dir,
        rel_dir,
        tracked_files=tracked_files,
        ignore_names=ignore_names,
        ignore_paths=ignore_paths,
        unignore_names=unignore_names,
        unignore_paths=unignore_paths,
    )

    for entry, entry_rel in entries:
        if entry.is_file(follow_symlinks=False):
            size, _created, _modified, mtime = _stat_fields(entry)
            _hash_file_entry(sig, entry_rel, size, mtime, entry_rel in dirty_paths)
        elif entry.is_dir(follow_symlinks=False):
            _walk_for_signature(
                entry.path,
                entry_rel,
                tracked_files=tracked_files,
                dirty_paths=dirty_paths,
                ignore_names=ignore_names,
                ignore_paths=ignore_paths,
                unignore_names=unignore_names,
                unignore_paths=unignore_paths,
                sig=sig,
            )


def signature_tree(
    root: str,
    *,
    use_cache: bool = True,
    extra_exclude_paths: frozenset[str] = frozenset(),
) -> SignatureResponse:
    """Cheap fingerprint of the tree — equivalent to scan_tree(root)['content_signature']
    but without building the full manifest.

    Walks the tree once with os.scandir, hashing (rel_path, size, mtime,
    dirty) per file plus repo-level git fields (branch / remote / head /
    dirty). Skips file content reads and the `git log` walk scan_tree
    uses for per-file created/modified history; both are cost-dominant
    on a big repo and don't feed the signature anyway.

    Honors the same skip list and ``<root>/.codecityignore`` file as
    scan_tree, so signatures stay in lockstep.

    ``use_cache`` is accepted for API symmetry with scan_tree (so both
    /api/manifest and /api/manifest/signature take the same query
    params) but is a no-op here — signature_tree doesn't compute
    per-file lines/binary or per-file git history, so there's nothing
    to cache.

    ``extra_exclude_paths`` — extra rel-paths skipped in addition to
    ``.codecityignore``, supplied by the UI.
    """
    root_abs = str(Path(root).resolve())
    root_path = Path(root_abs)
    if not _is_git_repo(root_path):
        raise NotAGitRepoError(root_abs)

    git = _collect_git_state(root_path)

    ignore_names, ignore_paths, unignore_names, unignore_paths = _load_codecityignore(
        root_path
    )
    if extra_exclude_paths:
        ignore_paths = ignore_paths | extra_exclude_paths

    sig = hashlib.blake2b(digest_size=16)
    _walk_for_signature(
        root_abs,
        ".",
        tracked_files=git.tracked,
        dirty_paths=git.dirty,
        ignore_names=ignore_names,
        ignore_paths=ignore_paths,
        unignore_names=unignore_names,
        unignore_paths=unignore_paths,
        sig=sig,
    )
    _hash_repo_info(sig, git.repo)

    return {
        "root": root_abs,
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "content_signature": sig.hexdigest(),
    }


# ── Time-travel reconstruction ───────────────────────────────────────────────
#
# Rebuild a Manifest AS OF a past ref using only read-only git plumbing
# (ls-tree + cat-file); the repo is never checked out or written. It shares
# _build_tree with the live scan, so structure_signature + layout_signature
# are byte-identical to a live scan of the same tree. content_signature does
# NOT match a live scan (the live hash folds in real fs mtime, which a ref
# reconstruction has no access to) — the ref manifest is keyed by ref sha, not
# by content_signature, so that's expected and harmless.


def _basename(rel_path: str) -> str:
    return rel_path.rsplit("/", 1)[-1]


def _path_is_skipped(
    rel_path: str,
    ignore_names: frozenset[str],
    ignore_paths: frozenset[str],
    unignore_names: frozenset[str],
    unignore_paths: frozenset[str],
) -> bool:
    """Apply _should_skip to every path segment (a skipped parent dir hides
    the file), mirroring the live tracked-walk's per-segment filtering."""
    parts = rel_path.split("/")
    for i in range(len(parts)):
        seg_rel = "/".join(parts[: i + 1])
        if _should_skip(
            parts[i],
            seg_rel,
            ignore_names=ignore_names,
            ignore_paths=ignore_paths,
            unignore_names=unignore_names,
            unignore_paths=unignore_paths,
        ):
            return True
    return False


def _dir_children_from_paths(
    paths: Iterable[str],
) -> dict[str, list[tuple[str, str, bool]]]:
    """Group a flat file-path list into a ``{rel_dir -> sorted [(name, rel,
    is_dir)]}`` map, materializing every intermediate directory. Entries in a
    dir are sorted by name; _build_tree then re-splits them into files-first,
    subdirs-second (each already name-sorted), matching the live scandir order
    the layout packer + signatures depend on."""
    children: dict[str, set[tuple[str, str, bool]]] = {}
    for p in paths:
        parts = p.split("/")
        for i in range(len(parts)):
            parent = "." if i == 0 else "/".join(parts[:i])
            name = parts[i]
            rel = "/".join(parts[: i + 1])
            is_dir = i < len(parts) - 1
            children.setdefault(parent, set()).add((name, rel, is_dir))
    return {k: sorted(v, key=lambda t: t[0]) for k, v in children.items()}


def _reconstructed_repo_info(root_path: Path, commit_sha: str) -> RepoInfo:
    """Repo footer for a detached ref: branch shows the short ref (there's no
    live branch), dirty is always False (a committed tree can't be dirty)."""
    subject = _run_git(root_path, "log", "-1", "--format=%s", commit_sha).strip()
    remote = _run_git(root_path, "config", "--get", "remote.origin.url").strip()
    return {
        "branch": f"@ {commit_sha[:8]}",
        "remote_url": _normalize_remote_to_web_url(remote) or None,
        "head_sha": commit_sha[:8],
        "head_subject": subject or None,
        "dirty": False,
    }


def reconstruct_manifest(root: str, ref: str, *, use_cache: bool = True) -> Manifest:
    """Build a Manifest for the repo AS OF ``ref``, read-only (ls-tree +
    cat-file). Never checks out or writes to the working tree.

    Raises ``NotAGitRepoError`` for a non-repo and ``ValueError`` for a ref
    that doesn't resolve to a commit."""
    root_abs = str(Path(root).resolve())
    root_path = Path(root_abs)
    if not _is_git_repo(root_path):
        raise NotAGitRepoError(root_abs)
    commit_sha = gitobj.resolve_ref(root_path, ref)
    if commit_sha is None:
        raise ValueError(f"ref does not resolve to a commit: {ref!r}")

    # File set + sizes (one ls-tree), filtered through the SAME skip rules the
    # live scan uses — .codecityignore is read from the CURRENT working copy so
    # the filter doesn't jump around as the ref moves.
    ignore_names, ignore_paths, unignore_names, unignore_paths = _load_codecityignore(
        root_path
    )
    blobs = [
        b
        for b in gitobj.ls_tree_files(root_path, commit_sha)
        if not _path_is_skipped(
            b.path, ignore_names, ignore_paths, unignore_names, unignore_paths
        )
    ]
    by_path = {b.path: b for b in blobs}

    # lines/binary/media: content-addressed blob cache first, cat-file only the
    # misses. Media dims are probed only for blobs whose path is a media file
    # (by extension) — same gate as the live scan, and it keeps hachoir off
    # every source blob.
    cached = cache_load_blobs(root_path) if use_cache else {}
    media_shas = frozenset(
        b.sha for b in blobs if media_kind(_extension(_basename(b.path)))
    )
    misses = [b.sha for b in blobs if b.sha not in cached]
    fresh = (
        gitobj.blob_stats_batch(root_path, misses, media_shas=media_shas)
        if misses
        else {}
    )
    for sha, s in fresh.items():
        entry: BlobEntry = {"lines": s.lines, "binary": s.binary, "size": s.size}
        if s.media_width is not None and s.media_height is not None:
            entry["media_width"], entry["media_height"] = s.media_width, s.media_height
        if s.binary_type is not None:
            entry["binaryType"] = s.binary_type
        cached[sha] = entry
    if fresh:
        cache_save_blobs(root_path, cached)

    # Ref-correct created/modified dates + the commit list, walked from the
    # resolved sha (not HEAD).
    git_created, git_modified, commits = _collect_git_history(
        root_path, use_cache=use_cache, ref=commit_sha
    )

    children_map = _dir_children_from_paths(by_path.keys())
    sig = hashlib.blake2b(digest_size=16)

    def list_children(rel_dir: str) -> list[tuple[str, str, bool]]:
        return children_map.get(rel_dir, [])

    def make_file_node(name: str, rel_path: str) -> FileNode:
        blob = by_path[rel_path]
        stats = cached.get(blob.sha, {"lines": 0, "binary": False})
        # mtime 0.0 + dirty False: a committed ref has no working-tree mtime and
        # can't be dirty. This makes content_signature diverge from a live scan
        # (expected — the ref manifest is keyed by ref sha, not content_sig).
        _hash_file_entry(sig, rel_path, blob.size, 0.0, False)
        return build_file_node(
            name=name,
            rel_path=rel_path,
            full_path=f"{root_abs}/{rel_path}",
            ext=_extension(name),
            size=blob.size,
            lines=stats["lines"],
            binary=stats["binary"],
            dirty=False,
            created=git_created.get(rel_path, ""),
            modified=git_modified.get(rel_path, ""),
            media_width=stats.get("media_width"),
            media_height=stats.get("media_height"),
            binary_type=stats.get("binaryType"),
        )

    tree = _build_tree(
        root_abs, ".", list_children=list_children, make_file_node=make_file_node
    )
    signals = _derive_tree_signals(tree)
    repo_info = _reconstructed_repo_info(root_path, commit_sha)
    return _wrap_manifest(root_abs, tree, sig, signals, repo_info, commits)
