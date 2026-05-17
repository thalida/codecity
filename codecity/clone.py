"""Clone-or-update a remote git repo into a persistent local cache.

Used by the server when the user passes a `?clone=URL[&branch=…]` query
instead of a local path. The clone is treated as read-only by codecity —
we only run plumbing commands against it (fetch, reset). Re-running with
the same URL+branch reuses the working copy on disk.

Cache layout::

    ~/.cache/codecity/clones/<sha1(url\\0branch)[:16]>/

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
from pathlib import Path


def _log(msg: str) -> None:
    if os.environ.get("CODECITY_QUIET") != "1":
        print(f"[clone] {msg}", file=sys.stderr, flush=True)


CACHE_ROOT = Path.home() / ".cache" / "codecity" / "clones"


class CloneError(RuntimeError):
    """Raised when a git operation fails. Carries the captured stderr."""


class BranchNotFoundError(CloneError):
    """Raised when the requested branch doesn't exist on the remote."""


class RepoNotFoundError(CloneError):
    """Raised when the remote repo URL doesn't exist or isn't accessible."""


class HostUnreachableError(CloneError):
    """Raised when DNS / network can't reach the remote host."""


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


def _run_git(*args: str, cwd: Path | None = None) -> str:
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "/usr/bin/true",
        "SSH_ASKPASS": "/usr/bin/true",
    }
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )
    except FileNotFoundError as e:
        raise CloneError("git executable not found on PATH") from e
    if proc.returncode != 0:
        raise CloneError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout


def clone_dir_for(url: str, branch: str | None) -> Path:
    digest = hashlib.sha1(f"{url}\0{branch or ''}".encode("utf-8")).hexdigest()[:16]
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
            _run_git("fetch", "--prune", "origin", cwd=target)
            ref = f"origin/{branch}" if branch else f"origin/{_resolve_default_branch(target)}"
            _run_git("reset", "--hard", ref, cwd=target)
        except CloneError as e:
            # On update-path failure: try clean-error translation, then re-raise.
            # The existing clone is NOT removed — it may still be valid.
            _maybe_raise_clean_clone_error(url, branch, str(e))
            raise
        return target

    _log(f"cloning {url} → {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    args = ["clone"]
    if branch:
        args += ["--branch", branch]
    args += ["--", url, str(target)]
    try:
        _run_git(*args)
    except CloneError as e:
        # First-clone failure: nuke the partial directory before re-raising,
        # so the next attempt isn't confused by a half-clone.
        shutil.rmtree(target, ignore_errors=True)
        _maybe_raise_clean_clone_error(url, branch, str(e))
        raise
    return target
