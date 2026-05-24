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
from pathlib import Path

from codecity.types import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
)

__all__ = [
    "BranchNotFoundError",
    "CloneError",
    "HostUnreachableError",
    "RepoNotFoundError",
    "clone_dir_for",
    "ensure_clone",
]


def _log(msg: str) -> None:
    if os.environ.get("CODECITY_QUIET") != "1":
        print(f"[clone] {msg}", file=sys.stderr, flush=True)


CACHE_ROOT = Path.home() / ".cache" / "codecity" / "clones"


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


def _run_git_streaming(*args: str, cwd: Path | None = None) -> str:
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
    boundaries."""
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
                    start = i + 1
            if start:
                del buf[:start]
        if buf:
            line = bytes(buf).decode("utf-8", errors="replace").strip()
            if line:
                captured_stderr.append(line)
                _log(line)

    def _drain_stdout() -> None:
        assert proc.stdout is not None
        stdout_holder.append(proc.stdout.read().decode("utf-8", errors="replace"))

    t_err = threading.Thread(target=_drain_stderr, daemon=True)
    t_out = threading.Thread(target=_drain_stdout, daemon=True)
    t_err.start()
    t_out.start()
    proc.wait()
    t_err.join()
    t_out.join()

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
    return CACHE_ROOT / digest


def _resolve_default_branch(repo: Path) -> str:
    """Return the default branch name on origin (e.g. 'main')."""
    out = _run_git("symbolic-ref", "refs/remotes/origin/HEAD", cwd=repo).strip()
    # e.g. "refs/remotes/origin/main" → "main"
    return out.rsplit("/", 1)[-1] if out else "HEAD"


def ensure_clone(url: str, branch: str | None = None) -> Path:
    """Clone ``url`` (optionally pinned to ``branch``) into the local cache,
    or fetch+reset if it already exists. Returns the local repo path.

    Raises one of:
      - BranchNotFoundError — requested branch absent on remote
      - RepoNotFoundError   — remote URL doesn't exist or is inaccessible
      - HostUnreachableError — DNS / network failure
      - CloneError          — any other git failure (auth, ssl, etc.)
    """
    target = clone_dir_for(url, branch)
    if target.exists():
        try:
            _log(f"fetching updates for {url}")
            _run_git_streaming("fetch", "--prune", "--progress", "origin", cwd=target)
            ref = f"origin/{branch}" if branch else f"origin/{_resolve_default_branch(target)}"
            _log(f"resetting to {ref}")
            _run_git("reset", "--hard", ref, cwd=target)
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
        _run_git_streaming(*args)
        _log("clone complete")
    except CloneError as e:
        # First-clone failure: nuke the partial directory before re-raising,
        # so the next attempt isn't confused by a half-clone.
        shutil.rmtree(target, ignore_errors=True)
        _maybe_raise_clean_clone_error(url, branch, str(e))
        raise
    return target
