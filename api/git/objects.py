"""Read-only git-object plumbing for reconstructing a past ref.

Everything here uses `git ls-tree` / `cat-file` / `rev-parse` — it never
checks out, resets, or otherwise writes to the repo. Invocation goes through cmd.git_argv, which
carries the safe.directory bypass.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Callable, NamedTuple

from api.git.cmd import git_argv
from api.utils.binfmt import detect_binary_type
from api.utils.shas import is_object_sha
from api.utils.content import count_lines, is_binary_bytes
from api.utils.media import probe_media_dims_from_bytes

# GIT_NO_LAZY_FETCH=1: on a blobless (--filter=blob:none) clone a missing
# historical blob reports "missing" instead of triggering a per-object promisor
# fetch — which for thousands of blobs hangs for minutes. The timeline hydrates
# the clone up front (clone.hydrate_blobs); this guarantees the fallback (a blob
# still absent, e.g. a monster file the hydrate skipped) degrades to 0 lines, not
# a hang.
_GIT_ENV = {**os.environ, "GIT_NO_LAZY_FETCH": "1"}


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        git_argv(root, *args),
        capture_output=True,
        check=False,
        env=_GIT_ENV,
    )


def resolve_ref(root: Path, ref: str) -> str | None:
    """Resolve `ref` to a full commit sha, or None if it doesn't name a
    commit. The `--end-of-options` / `--verify` combination makes a
    leading-dash `ref` be treated as a revision, never a flag, so an
    injection-style string simply fails to resolve."""
    out = (
        _git(
            root,
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            f"{ref}^{{commit}}",
        )
        .stdout.decode("ascii", "replace")
        .strip()
    )
    return out if is_object_sha(out) else None


class TreeBlob(NamedTuple):
    path: str
    sha: str
    size: int


def ls_tree_files(root: Path, commit_sha: str) -> list[TreeBlob]:
    """Every blob at `commit_sha` (recursive). Uses -z so paths with
    spaces/newlines survive; -l adds the blob size."""
    out = _git(root, "ls-tree", "-r", "-l", "-z", commit_sha).stdout.decode(
        "utf-8", "surrogateescape"
    )
    files: list[TreeBlob] = []
    for entry in out.split("\0"):
        if not entry:
            continue
        # "<mode> <type> <sha> <size>\t<path>"
        meta, _, path = entry.partition("\t")
        parts = meta.split()
        if len(parts) < 4 or parts[1] != "blob":
            continue  # skip submodules (commit) / trees
        if parts[0] == "120000":
            # A committed symlink is git type "blob" too, but the live scan's
            # _live_list_children only keeps is_file()/is_dir() with
            # follow_symlinks=False, which excludes symlinks entirely. Skip
            # them here so reconstruction matches the live scan.
            continue
        sha = parts[2]
        size = 0 if parts[3] == "-" else int(parts[3])
        files.append(TreeBlob(path=path, sha=sha, size=size))
    return files


class BlobStats(NamedTuple):
    lines: int
    binary: bool
    media_width: int | None
    media_height: int | None
    binary_type: str | None
    size: int  # real byte size (resolved for git-lfs, else the blob size)


# A git-lfs blob is a pointer, not content; resolve it so the timeline reads the
# same bytes Live's smudged working tree does.
_LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
_LFS_MAX_RESOLVE_BYTES = 128 * 1024 * 1024
_LFS_SMUDGE_TIMEOUT_S = 60  # per-object download budget before giving up (0 lines)


def _parse_lfs_pointer(content: bytes) -> tuple[str, int] | None:
    """(oid, byte size) if `content` is a git-lfs pointer, else None."""
    if not content.startswith(_LFS_POINTER_PREFIX):
        return None
    oid: str | None = None
    size: int | None = None
    for line in content[:512].split(b"\n"):
        if line.startswith(b"oid sha256:"):
            oid = line[len(b"oid sha256:") :].strip().decode("ascii", "ignore") or None
        elif line.startswith(b"size "):
            try:
                size = int(line[len(b"size ") :])
            except ValueError:
                pass
    return (oid, size) if oid and size is not None else None


def _lfs_smudge(root: Path, pointer: bytes) -> bytes | None:
    """Resolve an lfs pointer to real bytes via `git lfs smudge`, which downloads
    the object by oid from the remote when it isn't local (no tree scan, unlike
    `git lfs fetch`). None if git-lfs is absent or the object can't be fetched (a
    failed smudge echoes the pointer back)."""
    try:
        proc = subprocess.run(
            git_argv(root, "lfs", "smudge"),
            input=pointer,
            capture_output=True,
            check=False,
            env=_GIT_ENV,
            timeout=_LFS_SMUDGE_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    out = proc.stdout
    if proc.returncode != 0 or out.startswith(_LFS_POINTER_PREFIX):
        return None
    return out


def _resolve_lfs(root: Path, content: bytes, blob_size: int) -> tuple[bytes, int]:
    """(real bytes, size) for an lfs pointer, matching the working tree Live scans;
    non-pointer unchanged. Reads the local object, else smudges (downloads) it by
    oid. Unresolvable → (b'', declared size): 0 lines but the true footprint."""
    ptr = _parse_lfs_pointer(content)
    if ptr is None:
        return content, blob_size
    oid, declared = ptr
    if declared > _LFS_MAX_RESOLVE_BYTES:
        return b"", declared
    obj = root / ".git" / "lfs" / "objects" / oid[:2] / oid[2:4] / oid
    try:
        if obj.is_file():
            return obj.read_bytes(), declared
    except OSError:
        pass
    resolved = _lfs_smudge(root, content)
    return (resolved, declared) if resolved is not None else (b"", declared)


# Blobs per `cat-file --batch` call. One call for all of them buffers every
# blob's CONTENT in memory at once (gigabytes on a big history) and can report
# nothing until git has finished; chunking bounds both, and the extra spawns are
# noise next to the work.
_STATS_CHUNK = 2000


def blob_stats_batch(
    root: Path,
    shas: list[str],
    *,
    media_shas: frozenset[str] = frozenset(),
    on_progress: Callable[[int], None] | None = None,
) -> dict[str, BlobStats]:
    """Compute (lines, binary, media dims) for each blob via chunked
    `cat-file --batch` calls. Duplicate shas are de-duped; the returned dict is
    keyed by blob sha. ``on_progress`` gets the running resolved count.

    The media-dimension probe (hachoir-based) only runs for blobs whose
    sha is in `media_shas` — mirroring the live scanner, which only probes
    dims for files whose extension is a recognized media kind. Running it
    on every blob is wasteful (hachoir tries its whole format battery
    against plain source files) and noisy (hachoir logs a `[warn] Skip
    parser ...` line per rejected format). Lines + binary are still
    computed for every blob regardless."""
    unique = list(dict.fromkeys(shas))
    if not unique:
        return {}
    result: dict[str, BlobStats] = {}
    for start in range(0, len(unique), _STATS_CHUNK):
        _stats_into(result, root, unique[start : start + _STATS_CHUNK], media_shas)
        if on_progress is not None:
            on_progress(min(start + _STATS_CHUNK, len(unique)))
    return result


def _stats_into(
    result: dict[str, BlobStats],
    root: Path,
    unique: list[str],
    media_shas: frozenset[str],
) -> None:
    """One `cat-file --batch` over `unique`, parsed into `result`."""
    proc = subprocess.run(
        git_argv(root, "cat-file", "--batch"),
        input="\n".join(unique).encode("ascii"),
        capture_output=True,
        check=False,
        env=_GIT_ENV,
    )
    out = proc.stdout
    i = 0
    n = len(out)
    while i < n:
        nl = out.find(b"\n", i)
        if nl == -1:
            break
        header = out[i:nl].decode("ascii", "replace")
        i = nl + 1
        hp = header.split()
        # "<sha> missing" for an unknown object — skip it.
        if len(hp) != 3 or hp[1] != "blob":
            continue
        sha, size = hp[0], int(hp[2])
        content = out[i : i + size]
        i += size + 1  # trailing newline after content
        # git-lfs: pointer → real content so stats match Live.
        content, real_size = _resolve_lfs(root, content, size)
        binary = is_binary_bytes(content)
        lines = 0 if binary else count_lines(content)
        mw, mh = (
            probe_media_dims_from_bytes(content) if sha in media_shas else (None, None)
        )
        binary_type = detect_binary_type(content) if binary else None
        result[sha] = BlobStats(
            lines=lines,
            binary=binary,
            media_width=mw,
            media_height=mh,
            binary_type=binary_type,
            size=real_size,
        )


def read_blob(root: Path, sha: str) -> bytes | None:
    """Raw bytes of one blob, git-lfs pointers resolved like the live scan.
    None when the sha is not a blob in this repo."""
    proc = _git(root, "cat-file", "blob", sha)
    if proc.returncode != 0:
        return None
    content = proc.stdout
    resolved, _size = _resolve_lfs(root, content, len(content))
    return resolved


def blob_sizes_batch(root: Path, shas: list[str]) -> dict[str, int]:
    """Byte size of each blob via one `cat-file --batch-check` (no content)."""
    unique = list(dict.fromkeys(shas))
    if not unique:
        return {}
    proc = subprocess.run(
        git_argv(root, "cat-file", "--batch-check"),
        input="\n".join(unique).encode("ascii"),
        capture_output=True,
        check=False,
        env=_GIT_ENV,
    )
    out: dict[str, int] = {}
    for line in proc.stdout.decode("ascii", "replace").splitlines():
        parts = line.split()
        # "<sha> blob <size>"; "<sha> missing" for unknown objects.
        if len(parts) == 3 and parts[1] == "blob":
            out[parts[0]] = int(parts[2])
    return out
