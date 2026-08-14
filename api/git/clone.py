"""Clone-or-update a remote git repo into a persistent local cache.

Backs the server's `?clone=URL[&branch=…]` mode. codecity only ever runs
plumbing against the result (fetch, reset), never anything that writes history.

Cache layout::

    ~/.cache/codecity/clones/<sha256(url\\0branch)[:16]>/

The hash keeps the path filesystem-legal and stable across runs, so an existing
clone is reused rather than re-cloned.
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
from api.errors import ScanCancelledError


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


class CloneInterruptedError(CloneError):
    """The connection dropped mid-transfer (early EOF / RPC failed / unexpected
    disconnect). Common on very large repos over a flaky link; retryable."""


__all__ = [
    "BranchNotFoundError",
    "CloneError",
    "CloneInterruptedError",
    "HostUnreachableError",
    "RepoNotFoundError",
    "clone_dir_for",
    "ensure_clone",
    "fetch_lfs_history",
    "hydrate_blobs",
    "list_remote_branches",
]


def _log(msg: str) -> None:
    if not quiet():
        print(f"[clone] {msg}", file=sys.stderr, flush=True)


# Where git clones are cached: a `clones/` subdir under the shared cache root
# (config.CACHE_ROOT). Tests monkeypatch clone.CLONES_ROOT.
CLONES_ROOT = CACHE_ROOT / "clones"


# The server forwards every progress callback as one NDJSON event, and git
# emits ~1% steps on a big clone. Short enough to feel live, long enough to
# coalesce those.
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
# A host that asks for credentials rather than 404ing. The server has none by
# design, so this is the unreachable case with a different wording: Forgejo,
# GitLab, and git's own "could not read Username" once prompts are disabled.
_AUTH_REQUIRED_PATTERNS = (
    re.compile(r"Authentication failed", re.IGNORECASE),
    re.compile(r"Credentials are incorrect or have expired", re.IGNORECASE),
    re.compile(r"HTTP Basic: Access denied", re.IGNORECASE),
    re.compile(r"could not read Username", re.IGNORECASE),
    re.compile(r"terminal prompts disabled", re.IGNORECASE),
    re.compile(r"Permission denied \(publickey", re.IGNORECASE),
)
_HOST_UNREACHABLE_PATTERNS = (
    re.compile(r"Could not resolve host", re.IGNORECASE),
    re.compile(
        r"unable to access .+: (?:Couldn't resolve host|Failed to connect)",
        re.IGNORECASE,
    ),
)
# The URL reached a server, but it isn't a git repo — a typo'd path, or a copied
# web-page URL with an #anchor / ?query / /tree/<branch> suffix. git says
# "... not valid: is this a git repository?" or "does not appear to be a git
# repository".
_NOT_A_REPO_PATTERNS = (
    re.compile(r"is this a git repository", re.IGNORECASE),
    re.compile(r"does not appear to be a git repository", re.IGNORECASE),
)
# The transfer started but the connection dropped part-way — a flaky link or a
# giant repo (linux kernel: ~2 GB). git prints these AFTER a wall of progress.
_NETWORK_INTERRUPTED_PATTERNS = (
    re.compile(r"early EOF", re.IGNORECASE),
    re.compile(r"RPC failed", re.IGNORECASE),
    re.compile(r"unexpected disconnect", re.IGNORECASE),
    re.compile(r"fetch-pack: invalid index-pack output", re.IGNORECASE),
    re.compile(r"The remote end hung up unexpectedly", re.IGNORECASE),
)

# git --progress spam ("Receiving objects: 42%", "remote: Enumerating objects: …")
# arrives on stderr and, on failure, would otherwise be dumped verbatim into the
# error — thousands of percentage lines burying the one that matters.
_PROGRESS_NOISE_RE = re.compile(
    r"(?:Receiving|Resolving|Compressing|Counting|Enumerating)\s+(?:objects|deltas)",
    re.IGNORECASE,
)


# What a retry falls back to. GitHub's HTTP/2 multiplexing intermittently RSTs
# the pack transfer on very large repos ("curl 92 … CANCEL" → early EOF), and
# HTTP/1.1 rides that out at equivalent throughput for a one-pack clone. First
# attempts stay on git's own default. Must precede the subcommand.
_HTTP1_1 = ("-c", "http.version=HTTP/1.1")
# git ends a clone/fetch with a DETACHED `maintenance run --auto` (older git:
# `gc --auto`) that keeps writing into the repo, racing whoever reads or deletes it next.
_NO_AUTO_MAINTENANCE = ("-c", "maintenance.auto=false", "-c", "gc.auto=0")
# How many times to retry a clone/fetch that died on a transient network drop.
_NET_RETRY_ATTEMPTS = 3


def _is_network_interruption(text: str) -> bool:
    return any(pat.search(text) for pat in _NETWORK_INTERRUPTED_PATTERNS)


def _clean_git_stderr(text: str, limit: int = 12) -> str:
    """Strip git's --progress lines so a failure message shows the actual error
    (the `error:`/`fatal:` lines), not a wall of percentages. Keep the last
    `limit` meaningful lines."""
    kept = [
        ln
        for ln in text.splitlines()
        if ln.strip() and not _PROGRESS_NOISE_RE.search(ln)
    ]
    return "\n".join(kept[-limit:]).strip()


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
    for pat in _AUTH_REQUIRED_PATTERNS:
        if pat.search(stderr_text):
            # Deliberately the same wording: the server cannot tell a private
            # repo from a typo, and saying "private" would be a guess.
            raise RepoNotFoundError(f"repository not found at {url}")
    for pat in _NOT_A_REPO_PATTERNS:
        if pat.search(stderr_text):
            raise RepoNotFoundError(
                "that URL does not point to a git repository. Check it for typos "
                "or extra parts (a #anchor, ?query, or /tree/<branch> suffix)."
            )
    for pat in _HOST_UNREACHABLE_PATTERNS:
        if pat.search(stderr_text):
            raise HostUnreachableError("could not resolve host")
    if _is_network_interruption(stderr_text):
        raise CloneInterruptedError(
            "the clone was interrupted mid-download (the connection dropped). "
            "This is common on very large repos, so please try again."
        )


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
            f"{_clean_git_stderr(proc.stderr) or proc.stdout.strip()}"
        )
    return proc.stdout


# Heartbeat cadence for the stall watchdog. Sized for the silent gap after
# "Resolving deltas: 100% done" on a --filter=blob:none clone, where the
# promisor fetch materializes the tree emitting no progress at all. Long enough
# that a normal small clone never fires one.
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

    For the long network ops, so a multi-minute clone shows git's own progress
    instead of nothing. Splits on ``\\r`` as well as ``\\n`` because git
    overwrites its progress line in place, and reads raw bytes in chunks
    because a large clone emits stderr by the megabyte.

    ``progress_dir`` is sampled by the stall watchdog when git falls silent: a
    ``--filter=blob:none`` clone spends minutes in an on-demand blob fetch that
    git runs as a sub-process without ``--progress``, so pack-dir growth is the
    only progress signal there is."""
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
    # Throttle state for on_progress. A stage change always passes, so the
    # client sees counting → receiving → resolving regardless of the window.
    # Last-seen is tracked alongside last-emitted so each stage's terminal 100%
    # gets flushed rather than dropped inside the window, which would leave the
    # UI frozen at whatever percent happened to pass.
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
        stderr_text = _clean_git_stderr("\n".join(captured_stderr))
        raise CloneError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): "
            f"{stderr_text or stdout.strip()}"
        )
    return stdout


def _run_net_git(
    *args: str,
    before_retry: Callable[[], None] | None = None,
    cancel_event: "threading.Event | None" = None,
    **stream_kwargs: object,
) -> str:
    """_run_git_streaming for the big network ops, hardened against the flaky
    transfers that plague very large repos:

      - no detached auto-maintenance, which would outlive the call and keep
        writing into the repo;
      - retries with backoff. `before_retry` runs between attempts, e.g. to
        remove a half-written clone, which `git clone` can't resume into;
      - HTTP/1.1 from the second attempt on. The first rides git's own
        default (HTTP/2 against GitHub), and drops back only once that has
        actually failed, rather than giving up multiplexing for every repo.

    Only network drops retry; auth and not-found re-raise on the first try.
    """
    last_err: CloneError | None = None
    for attempt in range(_NET_RETRY_ATTEMPTS):
        try:
            return _run_git_streaming(
                *(() if attempt == 0 else _HTTP1_1),
                *_NO_AUTO_MAINTENANCE,
                *args,
                cancel_event=cancel_event,
                **stream_kwargs,
            )
        except CloneError as e:
            last_err = e
            if not _is_network_interruption(str(e)):
                raise
            if cancel_event is not None and cancel_event.is_set():
                raise ScanCancelledError() from e
            if attempt < _NET_RETRY_ATTEMPTS - 1:
                _log(
                    f"network drop mid-transfer; retrying "
                    f"({attempt + 2}/{_NET_RETRY_ATTEMPTS})"
                )
                if before_retry is not None:
                    before_retry()
                time.sleep(min(2**attempt, 5))
    assert last_err is not None
    raise last_err


def clone_dir_for(url: str, branch: str | None) -> Path:
    # SHA-256 to dodge the FIPS-environment DeprecationWarning on SHA-1; this
    # names a directory, so truncating to 64 bits is fine.
    digest = hashlib.sha256(f"{url}\0{branch or ''}".encode("utf-8")).hexdigest()[:16]
    return CLONES_ROOT / digest


_ORIGIN_PREFIX = "refs/remotes/origin/"


def _local_origin_branches(repo: Path) -> list[str]:
    """Names of the remote-tracking branches already fetched into ``repo``."""
    out = _run_git(
        "for-each-ref", "--format=%(refname:strip=3)", _ORIGIN_PREFIX, cwd=repo
    )
    return [name for name in out.split("\n") if name.strip() and name != "HEAD"]


def _resolve_default_branch(repo: Path, url: str) -> str | None:
    """Return origin's default branch name, or None when nothing was fetched.

    Only ``git clone`` writes ``refs/remotes/origin/HEAD``; ``git fetch`` never
    does, so a clone that never got one holds every branch but no record of the
    default. Missing is not empty: re-derive, and write the answer back.
    """
    try:
        out = _run_git("symbolic-ref", _ORIGIN_PREFIX + "HEAD", cwd=repo).strip()
        if out.startswith(_ORIGIN_PREFIX):
            return out[len(_ORIGIN_PREFIX) :]
    except CloneError as e:
        if "is not a symbolic ref" not in str(e):
            raise

    local = _local_origin_branches(repo)
    if not local:
        return None  # nothing fetched — the remote really is empty
    try:
        _, advertised = list_remote_branches(url)
    except CloneError:
        advertised = None  # offline / transient: fall back to what we hold
    default = next(
        (
            name
            for name in (advertised, *_DEFAULT_BRANCH_FALLBACKS)
            if name and name in local
        ),
        local[0] if len(local) == 1 else None,
    )
    if default:
        _log(f"origin/HEAD missing; resolved default branch to {default}")
        _record_origin_head(repo, default)
    return default


def _record_origin_head(repo: Path, branch: str) -> None:
    """Point ``refs/remotes/origin/HEAD`` at ``branch``. Best effort: failing to
    write this cache costs another resolve, not the load."""
    try:
        _run_git(
            "symbolic-ref",
            _ORIGIN_PREFIX + "HEAD",
            _ORIGIN_PREFIX + branch,
            cwd=repo,
        )
    except CloneError as e:
        _log(f"could not record origin/HEAD: {e}")


def _head_has_commit(repo: Path) -> bool:
    """True when HEAD resolves to a commit. False after a clone that couldn't
    resolve the remote's HEAD: it leaves HEAD dangling and nothing checked
    out, and reports success anyway."""
    try:
        _run_git("rev-parse", "--verify", "-q", "HEAD", cwd=repo)
        return True
    except CloneError:
        return False


def _reset_to(repo: Path, branch: str) -> None:
    """Hard-reset the working tree to ``origin/<branch>``.

    ``reset --hard`` moves whatever HEAD points at rather than repointing HEAD,
    so a dangling HEAD survives it: the tree fills but every history command
    still fails and the scan reads zero commits. Put HEAD on a branch first."""
    if not _head_has_commit(repo):
        _log(f"HEAD is not on a usable branch; pointing it at {branch}")
        _run_git("symbolic-ref", "HEAD", f"refs/heads/{branch}", cwd=repo)
    _run_git("reset", "--hard", f"origin/{branch}", cwd=repo)


def _ensure_checkout(target: Path, url: str, branch: str | None) -> None:
    """Check out the default branch when the clone didn't.

    ``git clone`` exits 0 when it can't resolve the remote's HEAD: it parks HEAD
    on a dangling ref and checks nothing out, so the repo scans as zero files
    with no error to prompt a re-clone."""
    if branch or _head_has_commit(target):
        return
    default = _resolve_default_branch(target, url)
    if not default:
        return  # genuinely empty remote — nothing to check out
    _log(f"clone left no checkout; resetting to origin/{default}")
    _reset_to(target, default)


def _repo_uses_lfs(target: Path) -> bool:
    """True when the checked-out tree has Git-LFS-tracked files. False when
    git-lfs isn't installed, so such a host degrades to plain clones."""
    try:
        return bool(_run_git("lfs", "ls-files", "-n", cwd=target).strip())
    except CloneError:
        return False


def _pull_lfs(
    target: Path,
    *,
    on_heartbeat: Callable[[int | None], None] | None = None,
    cancel_event: "threading.Event | None" = None,
) -> None:
    """Replace the pointer stubs a plain clone leaves behind with real bytes,
    for what HEAD references only.

    Best effort: on failure the pointers stay in place and previews degrade,
    rather than the whole load failing over unreachable LFS storage."""
    if not _repo_uses_lfs(target):
        return
    _log(f"pulling git lfs objects for {target}")
    try:
        # Heartbeat off the LFS object store (not .git/objects/pack — LFS bytes
        # land there) so a big download shows progress instead of a silent wait.
        _run_git_streaming(
            "lfs",
            "pull",
            cwd=target,
            progress_dir=target / ".git" / "lfs" / "objects",
            on_heartbeat=on_heartbeat,
            cancel_event=cancel_event,
        )
        _log("git lfs pull complete")
    except ScanCancelledError:
        raise
    except CloneError as e:
        _log(f"git lfs pull failed ({e}); leaving pointer files in place")


# git lfs pull only materializes HEAD; the timeline walks every commit, so its
# historical blobs need their objects too. Skip a multi-GB history rather than
# block a scan on a huge download.
_LFS_HISTORY_CAP_BYTES = 5 * 1024 * 1024 * 1024


def _lfs_history_bytes(target: Path) -> int:
    """Total byte size of every-history LFS object, or -1 if unknown."""
    try:
        out = _run_git("lfs", "ls-files", "--all", "--size", cwd=target)
    except CloneError:
        return -1
    units = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3}
    total = 0.0
    for m in re.finditer(r"\(([\d.]+)\s*([KMG]?B)\)", out):
        total += float(m.group(1)) * units.get(m.group(2), 1)
    return int(total)


def fetch_lfs_history(
    target: Path,
    *,
    on_heartbeat: Callable[[int | None], None] | None = None,
    cancel_event: "threading.Event | None" = None,
) -> None:
    """Fetch ALL-history Git LFS objects so the timeline reads real content at
    every commit, not just HEAD. Best-effort + capped; a missing object stays a
    pointer (0 lines) rather than failing the scan."""
    if not _repo_uses_lfs(target):
        return
    total = _lfs_history_bytes(target)
    if total > _LFS_HISTORY_CAP_BYTES:
        _log(f"lfs history ~{total // 1024**2}MB over cap; timeline uses HEAD lfs only")
        return
    _log(f"fetching all-history git lfs objects for {target}")
    try:
        _run_git_streaming(
            "lfs",
            "fetch",
            "--all",
            cwd=target,
            progress_dir=target / ".git" / "lfs" / "objects",
            on_heartbeat=on_heartbeat,
            cancel_event=cancel_event,
        )
        _log("git lfs fetch --all complete")
    except ScanCancelledError:
        raise
    except CloneError as e:
        _log(f"git lfs fetch --all failed ({e}); historical lfs stays as pointers")


def _fresh_clone(
    url: str,
    branch: str | None,
    target: Path,
    *,
    on_progress: Callable[[tuple[str, int]], None] | None = None,
    on_heartbeat: Callable[[int | None], None] | None = None,
    cancel_event: "threading.Event | None" = None,
) -> Path:
    """Clone ``url``@``branch`` into ``target`` (which must not already
    exist). On failure, nuke the partial directory and raise a translated
    CloneError so the next attempt isn't confused by a half-clone."""
    _log(f"cloning {url} → {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    pack_dir = target / ".git" / "objects" / "pack"
    # --filter=blob:none: HEAD's tree is still fully checked out and all commit
    # and tree history is kept, so per-file dates survive. Only historical file
    # contents are skipped, which scan.py never reads. Later fetches inherit the
    # filter via promisor config.
    #
    # --progress: stderr isn't a TTY here, so git needs telling.
    args = ["clone", "--filter=blob:none", "--progress"]
    if branch:
        args += ["--branch", branch]
    args += ["--", url, str(target)]
    try:
        # HTTP/1.1 + retry (see _run_net_git). A retry must start from a clean
        # target — git clone can't resume into a half-written directory.
        _run_net_git(
            *args,
            before_retry=lambda: shutil.rmtree(target, ignore_errors=True),
            progress_dir=pack_dir,
            on_progress=on_progress,
            on_heartbeat=on_heartbeat,
            cancel_event=cancel_event,
        )
        _log("clone complete")
    except CloneError as e:
        shutil.rmtree(target, ignore_errors=True)
        _maybe_raise_clean_clone_error(url, branch, str(e))
        raise
    _ensure_checkout(target, url, branch)
    _pull_lfs(target, on_heartbeat=on_heartbeat, cancel_event=cancel_event)
    return target


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

    ``on_progress`` receives ``(stage, percent)`` tuples parsed from git's
    ``--progress`` stderr, throttled to ~250ms.

    Self-healing: when the update path of an existing clone fails with anything
    other than a clean user-facing cause, the clone on disk is treated as
    corrupt and re-cloned from scratch.

    Raises BranchNotFoundError, RepoNotFoundError, HostUnreachableError, or
    CloneError.
    """
    target = clone_dir_for(url, branch)
    if target.exists():
        try:
            _log(f"fetching updates for {url}")
            # Same HTTP/1.1 + retry hardening as the clone. No before_retry: a
            # fetch into the existing repo is safe to re-run as-is.
            _run_net_git(
                "fetch",
                "--prune",
                "--progress",
                "origin",
                cwd=target,
                progress_dir=target / ".git" / "objects" / "pack",
                on_progress=on_progress,
                on_heartbeat=on_heartbeat,
                cancel_event=cancel_event,
            )
            default = None if branch else _resolve_default_branch(target, url)
            target_branch = branch or default
            if target_branch:
                _log(f"resetting to origin/{target_branch}")
                _reset_to(target, target_branch)
            else:
                # Nothing fetched, so nothing to reset to: an empty tree scans
                # to an empty manifest, which renders as an empty world.
                _log("remote has no commits; skipping reset")
            _pull_lfs(target, on_heartbeat=on_heartbeat, cancel_event=cancel_event)
            _log("update complete")
            return target
        except CloneError as e:
            # A clean user-facing cause (branch/repo gone, host down) is real —
            # translate + surface it, leaving the existing clone untouched.
            _maybe_raise_clean_clone_error(url, branch, str(e))
            # Otherwise the on-disk clone is corrupt or incomplete — classically
            # a --filter=blob:none clone interrupted mid-materialization, which
            # fetch+reset can't repair. Self-heal: discard it and clone fresh so
            # a wedged clone recovers on the next load instead of staying broken
            # with no UI escape hatch.
            _log(f"update failed ({e}); discarding clone and re-cloning fresh")
            shutil.rmtree(target, ignore_errors=True)
            # fall through to the fresh clone below

    return _fresh_clone(
        url,
        branch,
        target,
        on_progress=on_progress,
        on_heartbeat=on_heartbeat,
        cancel_event=cancel_event,
    )


# Per-blob size ceiling for the timeline backfill. Source/lock/media blobs sit
# far below this; the cap only skips checked-in monster binaries (datasets,
# models) whose per-commit copies would otherwise pull unbounded data across
# history. A skipped blob stays absent and reads as 0 lines (GIT_NO_LAZY_FETCH),
# never a hang.
_HYDRATE_BLOB_LIMIT = "50m"


# Written only once the backfill has actually landed. The widened filter can't
# say that: it has to be in place for the refetch, so a cancel or a network drop
# mid-fetch left the clone looking hydrated with its history still missing —
# every later timeline then read those blobs as 0 lines, 0 bytes.
_HYDRATED_MARKER = "codecity-hydrated"


def _hydrated_marker(target: Path) -> Path:
    return target / ".git" / _HYDRATED_MARKER


def hydrate_blobs(
    target: Path,
    *,
    on_progress: Callable[[tuple[str, int]], None] | None = None,
    on_heartbeat: Callable[[int | None], None] | None = None,
    cancel_event: "threading.Event | None" = None,
) -> bool:
    """Backfill a blobless clone so historical blobs are local, returning True
    when it fetched. The live scan only needs HEAD, but the timeline walks all
    history, where lazy per-blob promisor fetches hang for minutes on a large
    repo; one `--refetch` pulls them in a single packfile.

    Widening the filter before refetching leaves the clone at the wider one, so
    later fetches stay hydrated; the marker written after is what says the
    backfill finished."""
    if _partial_clone_filter(target) is None:
        return False  # a full clone already has every blob
    if _hydrated_marker(target).exists():
        return False
    _run_git(
        "config",
        "remote.origin.partialclonefilter",
        f"blob:limit={_HYDRATE_BLOB_LIMIT}",
        cwd=target,
    )
    _log(f"hydrating blobless clone {target} for timeline (backfilling history)")
    _run_net_git(
        "fetch",
        "--refetch",
        f"--filter=blob:limit={_HYDRATE_BLOB_LIMIT}",
        "--progress",
        "origin",
        cwd=target,
        progress_dir=target / ".git" / "objects" / "pack",
        on_progress=on_progress,
        on_heartbeat=on_heartbeat,
        cancel_event=cancel_event,
    )
    _hydrated_marker(target).touch()
    _log("hydrate complete")
    return True


def _partial_clone_filter(target: Path) -> str | None:
    """The clone's configured partial-clone filter (e.g. `blob:none`), or None
    for a full clone / when the key is absent."""
    try:
        return _run_git(
            "config", "--get", "remote.origin.partialclonefilter", cwd=target
        ).strip()
    except CloneError:
        return None


# ls-remote timeout: bounded so a black-holed remote can't wedge a request.
# 20s covers a slow-but-live remote; a real hang trips it and surfaces a clean
# HostUnreachableError to the caller.
_LS_REMOTE_TIMEOUT_S = 20


# Fallback default-branch names, in priority order, for servers that don't
# advertise a symbolic HEAD (seen on some Forgejo/Gitea instances). Used only
# when ls-remote gives no symref HEAD to read.
_DEFAULT_BRANCH_FALLBACKS = ("main", "master", "develop", "trunk", "default")


def _parse_ls_remote(stdout: str) -> tuple[list[str], str | None]:
    """Parse ``git ls-remote --symref`` output into ``(branch_names, default)``.

    ``default`` is the symref HEAD target when the server advertises one. When it
    doesn't (some servers omit a symbolic HEAD), fall back: a lone branch is
    unambiguously the default; otherwise the first conventional name present
    (``main``/``master``/…). ``None`` only when there's nothing to pick from."""
    default: str | None = None
    branches: list[str] = []
    for line in stdout.splitlines():
        # Symref line: "ref: refs/heads/main\tHEAD"
        if line.startswith("ref: ") and line.endswith("\tHEAD"):
            target = line[len("ref: ") :].split("\t", 1)[0]
            if target.startswith("refs/heads/"):
                default = target[len("refs/heads/") :]
            continue
        # Ref line: "<sha>\trefs/heads/<name>"
        parts = line.split("\t")
        if len(parts) == 2 and parts[1].startswith("refs/heads/"):
            branches.append(parts[1][len("refs/heads/") :])
    if default is None and branches:
        if len(branches) == 1:
            default = branches[0]
        else:
            default = next(
                (b for b in _DEFAULT_BRANCH_FALLBACKS if b in branches), None
            )
    return branches, default


def list_remote_branches(url: str) -> tuple[list[str], str | None]:
    """Return ``(branch_names, default_branch)`` for a remote git URL via
    ``git ls-remote --symref``, no clone required.

    ``default_branch`` is what HEAD points at, or a fallback when the remote
    omits a symbolic HEAD. Raises the same CloneError subclasses ``ensure_clone``
    does, so routers see one error taxonomy."""
    try:
        proc = subprocess.run(
            ["git", "ls-remote", "--symref", "--", url],
            capture_output=True,
            text=True,
            check=False,
            env=_git_env(),
            timeout=_LS_REMOTE_TIMEOUT_S,
        )
    except FileNotFoundError as e:
        raise CloneError("git executable not found on PATH") from e
    except subprocess.TimeoutExpired as e:
        raise HostUnreachableError("timed out reaching remote") from e
    if proc.returncode != 0:
        _maybe_raise_clean_clone_error(url, None, proc.stderr)
        raise CloneError(f"git ls-remote failed: {proc.stderr.strip()}")

    return _parse_ls_remote(proc.stdout)
