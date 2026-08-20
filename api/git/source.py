"""Source resolution: turn a raw ?src value into a scannable target.

Framework-agnostic domain logic shared by the manifest/signature/cache routes:
classify a source string (every source is a git repo — the only axis is whether
it's a local working tree or a remote URL to clone), validate a local working
tree, and clone a remote URL. No FastAPI here — `ResolveError` carries a
suggested HTTP status + message that the routers translate into an HTTPException
(or an SSE `error` event for the stream)."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from api.core.config import local_repos_allowed
from api.git.cmd import git_argv
from api.core.constants import ErrorCode
from api.git.clone import (
    BranchNotFoundError,
    clone_dir_for,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    ensure_clone,
)

_LOCAL_PATH_PREFIX = re.compile(r"^(/|~|\./|\.\./|[A-Za-z]:[\\/])")
_GIT_SSH_FORM = re.compile(r"^[^@]+@[^:]+:")

_NOT_GIT_ERROR = (
    "path is not inside a git working tree. CodeCity requires a git "
    "project: try `git init` inside the directory, or paste a git "
    "URL instead."
)

# `git init` is wrong advice for a directory git already tracks. Names the
# repository, since that is what has to be mounted.
_WORKTREE_GITDIR_ERROR = (
    "path is a git worktree, but its repository at {repo} is not mounted."
)
_WORKTREE_GITDIR_ERROR_BARE = (
    "path is a git worktree, but its git directory at {gitdir} is not mounted."
)

# Terse on purpose: the UI pairs this with a "how to enable" notice + link, so
# the restart instructions here would just duplicate it.
_LOCAL_DISABLED_ERROR = "local repositories are disabled"

# A read names a source the client saw a manifest for, so "not on disk" means
# the clone was swept or never happened here, not that the URL is wrong.
_UNSCANNED_ERROR = "source is not on disk: scan it first"


@dataclass(frozen=True)
class SourceRef:
    """The (src, branch) a scan was asked for, carried on the manifest it built.

    Reads send it back instead of an absolute path: `branch` has to be the value
    AS PASSED, since that is what the clone directory keys on."""

    src: str
    branch: str | None = None


@dataclass
class ResolveError(Exception):
    status: int
    message: str
    # Set only where the UI answers the failure differently, and carried here so
    # flattening a clone exception into a ResolveError doesn't lose which it was.
    code: ErrorCode | None = None


class SourceKind(StrEnum):
    """How a raw ?src= string classifies. Every source is a git repo; the only
    questions are whether it's recognized at all and, if so, whether it's a
    local working tree (scanned in place) or a remote URL (cloned into the
    cache). String values are stable human-readable forms (logs/debugging)."""

    INVALID = "invalid"
    LOCAL = "local"
    REMOTE = "remote"


def classify(raw: str) -> SourceKind:
    """Classify a raw ?src= value as a local path, a remote git URL, or invalid.

    Path-like prefixes (absolute, home, relative, Windows drive) → LOCAL.
    URLs (scheme:// or git@host:path SSH form) → REMOTE.
    Anything else → INVALID.
    """
    if not raw:
        return SourceKind.INVALID
    if _LOCAL_PATH_PREFIX.match(raw):
        return SourceKind.LOCAL
    if "://" in raw or _GIT_SSH_FORM.match(raw):
        return SourceKind.REMOTE
    return SourceKind.INVALID


def _is_git_working_tree(path: Path) -> bool:
    """Return True if path is inside a git working tree.

    Runs git rev-parse --is-inside-work-tree against `path`:
      - working tree (top-level OR subdir OR linked worktree) → "true"
      - bare repo → "false"
      - non-git directory → command fails with non-zero exit

    Goes through git_argv for the ``safe.directory=*`` bypass. Without it a
    bind-mounted repo whose owner isn't the process uid — the normal case for
    the container reading a host mount — fails with "dubious ownership", and
    this returns False, which surfaces as "not a git working tree, try
    `git init`" over a repo that is perfectly fine.

    Its own subprocess call rather than cmd.run_git: the timeout is the point,
    since this runs against a path the user just typed.

    Failures (missing git binary, timeout, OS error) all fall through to
    False — better to reject with a clear message than to scan a path we
    can't verify."""
    try:
        r = subprocess.run(
            git_argv(path, "rev-parse", "--is-inside-work-tree"),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0 and r.stdout.strip() == "true"


def _unreachable_worktree_gitdir(path: Path) -> str | None:
    """The gitdir a linked worktree points at, if that gitdir is missing.

    A linked worktree's `.git` is a file holding `gitdir: <abs path>`. In a
    container mounting only the worktree, that path is absent — the worktree is
    real, its repository just isn't there."""
    marker = path / ".git"
    if not marker.is_file():
        return None
    try:
        content = marker.read_text()
    except OSError:
        return None
    for line in content.splitlines():
        if line.startswith("gitdir:"):
            gitdir = line.removeprefix("gitdir:").strip()
            return None if Path(gitdir).exists() else gitdir
    return None


def _local_git_error(path: Path) -> str:
    """Why `path` isn't scannable, said in terms of what to do about it."""
    gitdir = _unreachable_worktree_gitdir(path)
    if not gitdir:
        return _NOT_GIT_ERROR
    # A worktree's gitdir is <repo>/.git/worktrees/<name>, and the directory
    # worth naming is the repo, not the pointer inside it.
    repo, marker, _ = gitdir.partition("/.git/")
    if marker and repo:
        return _WORKTREE_GITDIR_ERROR.format(repo=repo)
    return _WORKTREE_GITDIR_ERROR_BARE.format(gitdir=gitdir)


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
        raise ResolveError(400, _local_git_error(target))
    return target


def get_repo_root(ref: SourceRef) -> Path:
    """The directory this source already occupies, or ResolveError: 404 when it
    is not on disk, 403 when local paths are off.

    Strict on purpose, in the `get()`-raises sense: reads call this, and a read
    may not clone. resolve_source is the one that creates. It is also cheaper —
    no `git rev-parse` either, since a city asks for hundreds of files at once."""
    kind = classify(ref.src)
    if kind is SourceKind.INVALID:
        raise ResolveError(400, "unrecognized source: pass a local path or a git URL")
    if kind is SourceKind.LOCAL:
        if not local_repos_allowed():
            raise ResolveError(403, _LOCAL_DISABLED_ERROR)
        root = Path(ref.src).expanduser()
    else:
        root = clone_dir_for(ref.src, ref.branch)
    try:
        resolved = root.resolve(strict=True)
    except (OSError, RuntimeError):
        raise ResolveError(404, _UNSCANNED_ERROR)
    if not resolved.is_dir():
        raise ResolveError(404, _UNSCANNED_ERROR)
    return resolved


def within(root: Path, rel_path: str, *, must_exist: bool = True) -> Path:
    """`rel_path` resolved under `root`, or ResolveError if it lands outside.

    An absolute or `..`-laden path is not a special case: resolve() normalizes
    it, and the containment check below is what refuses it. `must_exist=False`
    for a path that is legitimately absent from the working tree — a Timeline
    blob names a path as it stood at some past commit — which is safe because a
    path that does not exist has no symlink of its own to redirect through."""
    try:
        target = (root / rel_path).resolve(strict=must_exist)
    except (OSError, RuntimeError):
        raise ResolveError(404, "not found")
    if target != root and root not in target.parents:
        raise ResolveError(403, "path is outside the repo")
    return target


def resolve_source(src: str, branch: str | None) -> Path:
    """Resolve a raw ?src into a scan-target path. Raises ResolveError on any
    validation failure. For a remote URL this performs the clone (network).

    The SSE manifest route does NOT use this — it clones on a worker thread
    (see the route) so clone progress streams and a mid-clone disconnect can
    cancel it. This blocking form backs the signature route."""
    if not src:
        raise ResolveError(400, "missing 'src' query param")
    kind = classify(src)
    if kind is SourceKind.INVALID:
        raise ResolveError(400, "unrecognized source: pass a local path or a git URL")
    if kind is SourceKind.REMOTE:
        try:
            return ensure_clone(src, branch)
        except RepoNotFoundError as e:
            raise ResolveError(400, str(e), ErrorCode.REPO_NOT_FOUND)
        except (BranchNotFoundError, HostUnreachableError) as e:
            raise ResolveError(400, str(e))
        except CloneError as e:
            raise ResolveError(502, str(e))
    # LOCAL — ignore any branch, scan the working tree in place
    return resolve_local(src)
