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
import subprocess
import sys
from pathlib import Path


def _log(msg: str) -> None:
    if os.environ.get("CODECITY_QUIET") != "1":
        print(f"[clone] {msg}", file=sys.stderr, flush=True)


CACHE_ROOT = Path.home() / ".cache" / "codecity" / "clones"


class CloneError(RuntimeError):
    """Raised when a git operation fails. Carries the captured stderr."""


def _run_git(*args: str, cwd: Path | None = None) -> str:
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as e:
        raise CloneError("git executable not found on PATH") from e
    if proc.returncode != 0:
        raise CloneError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    return proc.stdout


def _cache_dir_for(url: str, branch: str | None) -> Path:
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

    Raises ``CloneError`` if any git operation fails.
    """
    target = _cache_dir_for(url, branch)
    if target.exists():
        _log(f"updating existing clone at {target}")
        _run_git("fetch", "--prune", "origin", cwd=target)
        ref = f"origin/{branch}" if branch else f"origin/{_resolve_default_branch(target)}"
        _run_git("reset", "--hard", ref, cwd=target)
        return target

    _log(f"cloning {url} → {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    args = ["clone"]
    if branch:
        args += ["--branch", branch]
    args += ["--", url, str(target)]
    _run_git(*args)
    return target
