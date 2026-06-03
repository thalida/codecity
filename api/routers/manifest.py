"""/api/manifest/signature, DELETE /api/manifest/cache.

Source classification + resolution shared by the signature route, cache
route, and the SSE manifest stream (added in a later task). Local sources
require CODECITY_ALLOW_LOCAL_REPOS and a git working tree; git URLs are
cloned via the service layer.

ResolveError carries a status + message; the signature/cache routes turn
it into an HTTPException. The SSE route (added later) turns it into an
`error` event instead (EventSource can't read 4xx bodies)."""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from api.config import local_repos_allowed
from api.models.manifest import SignatureResponse
from api.models.responses import CacheClearResponse
from api.security import TRUST
from api.services.cache import cache_clear_manifests
from api.services.clone import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    clone_dir_for,
    ensure_clone,
)
from api.services.scan import signature_tree

router = APIRouter(prefix="/api", tags=["manifest"])

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


def resolve_source(src: str, branch: str | None) -> Resolved:
    """Resolve a raw ?src into a scan target. Raises ResolveError on any
    validation failure. For git URLs this performs the clone (network)."""
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
    return Resolved(target, src, None, "local", src)


@router.get("/manifest/signature", response_model=SignatureResponse)
def signature(
    src: str = Query(...),
    branch: str | None = Query(None),
    no_cache: bool = Query(False),
) -> SignatureResponse:
    try:
        resolved = resolve_source(src, branch)
    except ResolveError as e:
        raise HTTPException(e.status, e.message)
    try:
        sig = signature_tree(str(resolved.path), use_cache=not no_cache)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"signature failed: {e}")
    return SignatureResponse.model_validate(dict(sig))


@router.delete("/manifest/cache", response_model=CacheClearResponse)
def clear_cache(
    src: str = Query(...),
    branch: str | None = Query(None),
) -> CacheClearResponse:
    if not src:
        raise HTTPException(400, "missing 'src' query param")
    kind = classify(src)
    if kind == "invalid":
        raise HTTPException(400, "unrecognized source — pass a local path or a git URL")
    if kind == "git":
        abs_root = clone_dir_for(src, branch)
    else:
        # Non-strict resolve so a recents entry for a since-deleted path
        # still drops its cache.
        abs_root = Path(src).resolve(strict=False)
    return CacheClearResponse(deleted=cache_clear_manifests(abs_root))
