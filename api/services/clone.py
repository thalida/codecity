"""Clone-or-update a remote git repo into a persistent local cache.

Used by the server when the user passes a `?clone=URL[&branch=…]` query
instead of a local path. The clone is treated as read-only by codecity —
we only run plumbing commands against it (fetch, reset). Re-running with
the same URL+branch reuses the working copy on disk.

Cache layout::

    ~/.cache/codecity/clones/<sha256(url\\0branch)[:16]>/

Why the hash: shorter than the URL, contains no filesystem-illegal
characters, and stays stable across runs so the "don't reclone if it
already exists" requirement actually holds.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable

from api.config import CACHE_ROOT, quiet

# Cancellation is signalled by the same threading.Event the scan honors, so a
# client disconnect aborts the clone phase too. scan.py does not import clone,
# so this import is cycle-free.
from api.services.scan import ScanCancelledError


class CloneError(RuntimeError):
    """Generic git clone/update failure. Subclasses below differentiate
    the user-facing causes so the server can return a clean 4xx with a
    helpful message instead of bubbling raw git stderr."""


class BranchNotFoundError(CloneError):
    """User asked for a branch that doesn't exist on the remote."""


class RepoNotFoundError(CloneError):
    """Remote URL doesn't exist, is private + unauthenticated, or was
    typo'd."""


class HostUnreachableError(CloneError):
    """DNS / network failure reaching the remote host."""


__all__ = [
    "BranchNotFoundError",
    "CloneError",
    "HostUnreachableError",
    "RepoNotFoundError",
    "clone_dir_for",
    "ensure_clone",
]


def _log(msg: str) -> None:
    if not quiet():
        print(f"[clone] {msg}", file=sys.stderr, flush=True)


# Where git clones are cached: a `clones/` subdir under the shared cache root
# (config.CACHE_ROOT). Tests monkeypatch clone.CLONES_ROOT.
CLONES_ROOT = CACHE_ROOT / "clones"


# Progress events arrive from git stderr as fast as one per few-percent
# step. Throttle the user-facing callback so the NDJSON stream isn't
# flooded with redundant payloads (the server forwards every callback
# fire as one event). 250ms is short enough to feel live, long enough
# to coalesce the ~1% steps git emits for big clones.
CLONE_PROGRESS_THROTTLE_S = 0.25


_CLONE_PROGRESS_RE = re.compile(
    r"^(Receiving|Resolving|Counting|Updating) (?:objects|deltas|files):\s*(\d+)%"
)


def _parse_clone_progress_line(line: str) -> tuple[str, int] | None:
    """Parse one line of ``git clone --progress`` stderr output.

    Returns ``(stage, percent)`` for matchable progress lines, else None.
    Stage is lowercase: ``'receiving' | 'resolving' | 'counting' | 'updating'``
    ('updating' = the checkout phase, ``Updating files: N%``)."""
    m = _CLONE_PROGRESS_RE.match(line.strip())
    if m is None:
        return None
    stage = m.group(1).lower()
    percent = int(m.group(2))
    return stage, percent


_BRANCH_NOT_FOUND_PATTERNS = (
    re.compile(r"Remote branch \S+ not found", re.IGNORECASE),
    re.compile(r"unknown revision or path not in the working tree"),
)
_REPO_NOT_FOUND_PATTERNS = (
    re.compile(r"Repository not found", re.IGNORECASE),
    re.compile(r"does not exist or you do not have access", re.IGNORECASE),
)
_HOST_UNREACHABLE_PATTERNS = (
    re.compile(r"Could not resolve host", re.IGNORECASE),
    re.compile(
        r"unable to access .+: (?:Couldn't resolve host|Failed to connect)",
        re.IGNORECASE,
    ),
)


def _maybe_raise_clean_clone_error(
    url: str, branch: str | None, stderr_text: str
) -> None:
    """Inspect git stderr and raise a user-friendly CloneError subclass when
    a known pattern matches. Returns None when nothing matched — caller is
    responsible for raising the original generic CloneError in that case."""
    if branch:
        for pat in _BRANCH_NOT_FOUND_PATTERNS:
            if pat.search(stderr_text):
                raise BranchNotFoundError(f"branch '{branch}' not found")
    for pat in _REPO_NOT_FOUND_PATTERNS:
        if pat.search(stderr_text):
            raise RepoNotFoundError(f"repository not found at {url}")
    for pat in _HOST_UNREACHABLE_PATTERNS:
        if pat.search(stderr_text):
            raise HostUnreachableError("could not resolve host")


def _git_env() -> dict[str, str]:
    return {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "/usr/bin/true",
        "SSH_ASKPASS": "/usr/bin/true",
    }


def _run_git(*args: str, cwd: Path | None = None) -> str:
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
            env=_git_env(),
        )
    except FileNotFoundError as e:
        raise CloneError("git executable not found on PATH") from e
    if proc.returncode != 0:
        raise CloneError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout


# Heartbeat cadence for the stall watchdog. Tuned for the gap between
# git's "Resolving deltas: 100% done" and clone return on a large
# --filter=blob:none clone — that gap is the on-demand promisor fetch
# materializing the working tree, which emits no progress at all. Short
# enough that the user notices the heartbeat within a few seconds of
# git falling silent; long enough that a normal small clone never sees
# a heartbeat fire at all.
_STALL_HEARTBEAT_SECS = 5.0


def _pack_dir_bytes(pack_dir: Path) -> int:
    """Sum of file sizes directly under ``pack_dir``. Non-recursive: git
    writes `pack-<sha>.pack` and `pack-<sha>.idx` flat in this dir, so
    we don't need to descend. Returns 0 if the dir doesn't exist yet
    (clone is still setting up .git/)."""
    total = 0
    try:
        for entry in os.scandir(pack_dir):
            try:
                if entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
            except OSError:
                continue
    except OSError:
        return 0
    return total


def _run_git_streaming(
    *args: str,
    cwd: Path | None = None,
    progress_dir: Path | None = None,
    on_progress: Callable[[tuple[str, int]], None] | None = None,
    on_heartbeat: Callable[[int | None], None] | None = None,
    cancel_event: "threading.Event | None" = None,
) -> str:
    """Run git and forward stderr to ``_log`` line-by-line as it arrives.

    Use for long-running network ops (clone, fetch) so the user sees
    git's own ``--progress`` output ("Receiving objects: 42% …") in
    real time instead of a silent multi-minute wait. Captures stderr
    in parallel so error-pattern translation still works on non-zero
    exit. Splits on either ``\\n`` or ``\\r`` because git overwrites
    the progress line in place with carriage returns.

    Binary mode + chunked reads: an earlier byte-per-iteration loop was
    a syscall hot spot on large clones (linux kernel: ~5M stderr bytes
    → ~5M read() calls). 4 KB chunks reduce that to ~1.2K syscalls
    without changing semantics — we still split on the same CR/LF
    boundaries.

    ``progress_dir`` (typically the clone target's
    ``.git/objects/pack``) is sampled by the stall watchdog when git
    falls silent. ``--filter=blob:none`` clones spend minutes in a
    silent on-demand blob fetch after "Resolving deltas: 100% done";
    git launches it as an internal sub-process that does NOT inherit
    ``--progress``, so we'd otherwise show nothing for the entire
    materialization phase. The watchdog surfaces pack-dir growth so
    the user can see download progress."""
    try:
        proc = subprocess.Popen(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,  # raw bytes — we decode after splitting
            env=_git_env(),
            bufsize=0,
        )
    except FileNotFoundError as e:
        raise CloneError("git executable not found on PATH") from e

    captured_stderr: list[str] = []
    stdout_holder: list[str] = []
    # Wall-clock of the last stderr line we forwarded. The watchdog
    # treats anything older than _STALL_HEARTBEAT_SECS as a stall.
    last_output_at = [time.monotonic()]
    # Throttle state for on_progress: when the last callback fired and
    # the last (stage, percent) tuple emitted. We coalesce identical
    # back-to-back payloads within the throttle window, but ALWAYS let
    # a payload through when the stage changes (so the client sees the
    # transition from 'counting' → 'receiving' → 'resolving' even if
    # the throttle window hasn't elapsed).
    #
    # We also track the LAST SEEN payload (regardless of whether it was
    # emitted). On stage change and at end-of-stream we flush the most
    # recent seen value if it wasn't emitted — otherwise the terminal
    # percent of each stage (typically 100%) gets silently dropped when
    # it arrives within 250ms of the previous emit, freezing the UI at
    # whatever value happened to pass the throttle.
    last_progress_at = [0.0]
    last_emitted_payload: list[tuple[str, int] | None] = [None]
    last_seen_payload: list[tuple[str, int] | None] = [None]
    proc_done = threading.Event()

    def _maybe_emit_progress(line: str) -> None:
        if on_progress is None:
            return
        parsed = _parse_clone_progress_line(line)
        if parsed is None:
            return
        now = time.monotonic()
        prev = last_emitted_payload[0]
        same_stage = prev is not None and prev[0] == parsed[0]
        # Stage change: flush the previous stage's terminal value first
        # so the UI sees e.g. "resolving 100%" before "receiving 1%".
        if not same_stage and prev is not None:
            last_seen = last_seen_payload[0]
            if last_seen is not None and last_seen != prev:
                on_progress(last_seen)
                last_emitted_payload[0] = last_seen
        last_seen_payload[0] = parsed
        if same_stage and now - last_progress_at[0] < CLONE_PROGRESS_THROTTLE_S:
            return
        on_progress(parsed)
        last_progress_at[0] = now
        last_emitted_payload[0] = parsed

    def _flush_progress() -> None:
        """Emit the most recently seen payload if it wasn't emitted.
        Called at end-of-stream so the terminal value (e.g. 100%) reaches
        the UI even when the throttle suppressed it."""
        if on_progress is None:
            return
        last_seen = last_seen_payload[0]
        if last_seen is not None and last_seen != last_emitted_payload[0]:
            on_progress(last_seen)
            last_emitted_payload[0] = last_seen

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        buf = bytearray()
        while True:
            chunk = proc.stderr.read(4096)
            if not chunk:
                break
            buf.extend(chunk)
            # Emit every complete line (terminated by either \n or \r,
            # whichever comes first). Anything past the last separator
            # stays in buf for the next chunk.
            start = 0
            for i, b in enumerate(buf):
                if b == 0x0A or b == 0x0D:  # LF or CR
                    line = bytes(buf[start:i]).decode("utf-8", errors="replace").strip()
                    if line:
                        captured_stderr.append(line)
                        _log(line)
                        last_output_at[0] = time.monotonic()
                        _maybe_emit_progress(line)
                    start = i + 1
            if start:
                del buf[:start]
        if buf:
            line = bytes(buf).decode("utf-8", errors="replace").strip()
            if line:
                captured_stderr.append(line)
                _log(line)
                last_output_at[0] = time.monotonic()
                _maybe_emit_progress(line)
        _flush_progress()

    def _drain_stdout() -> None:
        assert proc.stdout is not None
        stdout_holder.append(proc.stdout.read().decode("utf-8", errors="replace"))

    def _heartbeat() -> None:
        """Emit a 'still working' line when git has been silent past the
        threshold. Includes pack-dir size + delta when ``progress_dir``
        is set so the user sees actual download progress during the
        promisor blob fetch (which is otherwise invisible)."""
        last_bytes: int | None = None
        # Poll faster than the threshold so we notice stalls within
        # roughly one threshold period, not two. Capped at 1s so quick
        # commands don't pay any noticeable thread-wakeup overhead.
        poll = min(1.0, _STALL_HEARTBEAT_SECS / 3)
        while not proc_done.wait(poll):
            silent_for = time.monotonic() - last_output_at[0]
            if silent_for < _STALL_HEARTBEAT_SECS:
                continue
            size_note = ""
            current_mb: int | None = None
            if progress_dir is not None:
                current = _pack_dir_bytes(progress_dir)
                current_mb = round(current / (1024 * 1024))
                if last_bytes is not None:
                    delta_mb = (current - last_bytes) / (1024 * 1024)
                    size_note = (
                        f", {current_mb} MB on disk "
                        f"({delta_mb:+.1f} MB since last tick)"
                    )
                else:
                    size_note = f", {current_mb} MB on disk"
                last_bytes = current
            _log(f"still working… ({silent_for:.0f}s silent{size_note})")
            # Forward the heartbeat to the UI so the otherwise-silent promisor
            # blob fetch (no git progress lines) shows the tree materializing
            # instead of the clone-progress bar freezing at its last percent.
            if on_heartbeat is not None:
                on_heartbeat(current_mb)
            # Reset so the next heartbeat fires at a regular cadence
            # instead of every second once silent_for > threshold.
            last_output_at[0] = time.monotonic()

    t_err = threading.Thread(target=_drain_stderr, daemon=True)
    t_out = threading.Thread(target=_drain_stdout, daemon=True)
    t_heartbeat = threading.Thread(target=_heartbeat, daemon=True)
    t_err.start()
    t_out.start()
    t_heartbeat.start()

    # Cancel watcher: if cancellation is requested mid-clone (client
    # disconnected), kill git so proc.wait() below returns promptly instead of
    # running the whole clone to completion as an orphan. No-op (returns at
    # once) when no cancel_event is supplied.
    def _watch_cancel() -> None:
        if cancel_event is None:
            return
        while not proc_done.wait(0.2):
            if cancel_event.is_set():
                proc.kill()
                return

    t_cancel = threading.Thread(target=_watch_cancel, daemon=True)
    t_cancel.start()

    proc.wait()
    proc_done.set()
    t_err.join()
    t_out.join()
    t_heartbeat.join()
    t_cancel.join()
    if cancel_event is not None and cancel_event.is_set():
        raise ScanCancelledError()

    stdout = stdout_holder[0] if stdout_holder else ""
    if proc.returncode != 0:
        stderr_text = "\n".join(captured_stderr).strip()
        raise CloneError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): "
            f"{stderr_text or stdout.strip()}"
        )
    return stdout


def clone_dir_for(url: str, branch: str | None) -> Path:
    # SHA-256 (not SHA-1) — same length when truncated to 16 hex chars,
    # but avoids the FIPS-environment DeprecationWarning on SHA-1.
    # This is a directory-naming hash, not a security primitive; truncation
    # to 16 chars (64 bits) is acceptable collision-wise here.
    digest = hashlib.sha256(f"{url}\0{branch or ''}".encode("utf-8")).hexdigest()[:16]
    return CLONES_ROOT / digest


def _resolve_default_branch(repo: Path) -> str | None:
    """Return the default branch name on origin (e.g. 'main'), or None
    when the remote has no commits yet (an unborn HEAD).

    A brand-new empty github.com/<owner>/<name> repo clones successfully
    but has no symbolic refs/remotes/origin/HEAD — `git symbolic-ref`
    exits non-zero. Treat that as "nothing to check out" rather than an
    error: the caller skips the post-clone reset and the working tree
    stays empty, which the scanner happily walks into an empty manifest
    so the frontend renders an empty world.
    """
    try:
        out = _run_git("symbolic-ref", "refs/remotes/origin/HEAD", cwd=repo).strip()
    except CloneError as e:
        if "is not a symbolic ref" in str(e):
            return None
        raise
    # e.g. "refs/remotes/origin/main" → "main"
    return out.rsplit("/", 1)[-1] if out else None


def ensure_clone(
    url: str,
    branch: str | None = None,
    *,
    on_progress: Callable[[tuple[str, int]], None] | None = None,
    on_heartbeat: Callable[[int | None], None] | None = None,
    cancel_event: "threading.Event | None" = None,
) -> Path:
    """Clone ``url`` (optionally pinned to ``branch``) into the local cache,
    or fetch+reset if it already exists. Returns the local repo path.

    ``on_progress``, if set, is invoked with ``(stage, percent)`` tuples
    parsed from ``git --progress`` stderr, throttled to ~250ms.
    Server-side this becomes one ``cloning`` NDJSON event per call.

    Raises one of:
      - BranchNotFoundError — requested branch absent on remote
      - RepoNotFoundError   — remote URL doesn't exist or is inaccessible
      - HostUnreachableError — DNS / network failure
      - CloneError          — any other git failure (auth, ssl, etc.)
    """
    target = clone_dir_for(url, branch)
    pack_dir = target / ".git" / "objects" / "pack"
    if target.exists():
        try:
            _log(f"fetching updates for {url}")
            _run_git_streaming(
                "fetch",
                "--prune",
                "--progress",
                "origin",
                cwd=target,
                progress_dir=pack_dir,
                on_progress=on_progress,
                on_heartbeat=on_heartbeat,
                cancel_event=cancel_event,
            )
            default = None if branch else _resolve_default_branch(target)
            if branch or default:
                ref = f"origin/{branch or default}"
                _log(f"resetting to {ref}")
                _run_git("reset", "--hard", ref, cwd=target)
            else:
                # Remote has no commits yet — nothing to reset to. Leave
                # the working tree empty; the scanner will produce an
                # empty manifest and the frontend renders an empty world.
                _log("remote has no commits; skipping reset")
            _log("update complete")
        except CloneError as e:
            # On update-path failure: try clean-error translation, then re-raise.
            # The existing clone is NOT removed — it may still be valid.
            _maybe_raise_clean_clone_error(url, branch, str(e))
            raise
        return target

    _log(f"cloning {url} → {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    # --filter=blob:none: blobless partial clone. Working tree at HEAD is
    # fully checked out (line counts, image dimensions, file sizes all work
    # against on-disk files), and full commit + tree history is preserved
    # so `git log --name-only` keeps producing per-file created/modified
    # dates for the building-age signal. Only *historical* file contents
    # are skipped — which scan.py never reads. Future `git fetch` calls on
    # this clone automatically respect the same filter via promisor config.
    #
    # --progress forces git to emit "Receiving objects: …" lines even
    # though stderr isn't a TTY (we pipe it via _run_git_streaming).
    args = ["clone", "--filter=blob:none", "--progress"]
    if branch:
        args += ["--branch", branch]
    args += ["--", url, str(target)]
    try:
        _run_git_streaming(
            *args,
            progress_dir=pack_dir,
            on_progress=on_progress,
            on_heartbeat=on_heartbeat,
            cancel_event=cancel_event,
        )
        _log("clone complete")
    except CloneError as e:
        # First-clone failure: nuke the partial directory before re-raising,
        # so the next attempt isn't confused by a half-clone.
        shutil.rmtree(target, ignore_errors=True)
        _maybe_raise_clean_clone_error(url, branch, str(e))
        raise
    return target
