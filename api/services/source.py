"""Source resolution: turn a raw ?src value into a scannable target.

Framework-agnostic domain logic shared by the manifest/signature/cache routes:
classify a source string as a local path or git URL, validate a local working
tree, and clone a git URL. No FastAPI here — `ResolveError` carries a suggested
HTTP status + message that the routers translate into an HTTPException (or an
SSE `error` event for the stream)."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from api.config import local_repos_allowed
from api.security import TRUST
from api.services.clone import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    ensure_clone,
)

_LOCAL_PATH_PREFIX = re.compile(r"^(/|~|\./|\.\./|[A-Za-z]:[\\/])")
_GIT_SSH_FORM = re.compile(r"^[^@]+@[^:]+:")

_NOT_GIT_ERROR = (
    "path is not inside a git working tree. CodeCity requires a git "
    "project — try `git init` inside the directory, or paste a git "
    "URL instead."
)

_LOCAL_DISABLED_ERROR = (
    "local repositories are disabled — restart codecity with "
    "CODECITY_ALLOW_LOCAL_REPOS=1. "
    "See https://github.com/thalida/codecity#local-directories"
)


@dataclass
class ResolveError(Exception):
    status: int
    message: str


@dataclass
class Resolved:
    path: Path
    src: str
    branch: str | None
    kind: Literal["local", "git"]
    display_root: str


def classify(raw: str) -> Literal["local", "git", "invalid"]:
    """Classify a raw ?src= value as a local path, a git URL, or invalid.

    Path-like prefixes (absolute, home, relative, Windows drive) → 'local'.
    URLs (scheme:// or git@host:path SSH form) → 'git'.
    Anything else → 'invalid'.
    """
    if not raw:
        return "invalid"
    if _LOCAL_PATH_PREFIX.match(raw):
        return "local"
    if "://" in raw or _GIT_SSH_FORM.match(raw):
        return "git"
    return "invalid"


def _is_git_working_tree(path: Path) -> bool:
    """Return True if path is inside a git working tree.

    Runs git rev-parse --is-inside-work-tree with cwd=path:
      - working tree (top-level OR subdir OR linked worktree) → "true"
      - bare repo → "false"
      - non-git directory → command fails with non-zero exit

    Failures (missing git binary, timeout, OS error) all fall through to
    False — better to reject with a clear message than to scan a path we
    can't verify."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(path),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0 and r.stdout.strip() == "true"


def resolve_local(src: str) -> Path:
    """Validate a local source path (no network) and return the resolved dir.
    Raises ResolveError on any validation failure."""
    if not local_repos_allowed():
        raise ResolveError(403, _LOCAL_DISABLED_ERROR)
    try:
        target = Path(src).resolve(strict=True)
    except (OSError, RuntimeError):
        raise ResolveError(404, "path not found")
    if not target.is_dir():
        raise ResolveError(400, "path is not a directory")
    if not _is_git_working_tree(target):
        raise ResolveError(400, _NOT_GIT_ERROR)
    return target


def resolve_source(src: str, branch: str | None) -> Resolved:
    """Resolve a raw ?src into a scan target. Raises ResolveError on any
    validation failure. For git URLs this performs the clone (network).

    The SSE manifest route does NOT use this — it clones on a worker thread
    (see the route) so clone progress streams and a mid-clone disconnect can
    cancel it. This blocking form backs the signature route."""
    if not src:
        raise ResolveError(400, "missing 'src' query param")
    kind = classify(src)
    if kind == "invalid":
        raise ResolveError(400, "unrecognized source — pass a local path or a git URL")
    if kind == "git":
        display = f"{src}@{branch}" if branch else src
        try:
            with TRUST.clone_lock:
                local = ensure_clone(src, branch)
        except (BranchNotFoundError, RepoNotFoundError, HostUnreachableError) as e:
            raise ResolveError(400, str(e))
        except CloneError as e:
            raise ResolveError(502, str(e))
        return Resolved(local, src, branch, "git", display)
    # kind == "local" — ignore any branch, scan the working tree in place
    return Resolved(resolve_local(src), src, None, "local", src)
