"""Read-only git-object plumbing for reconstructing a past ref.

Everything here uses `git ls-tree` / `cat-file` / `rev-parse` — it never
checks out, resets, or otherwise writes to the repo. `-c safe.directory=*`
mirrors scan._run_git so we can read repos the process doesn't own.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import NamedTuple

from .media import probe_media_dims_from_bytes

_SHA40 = re.compile(r"^[0-9a-f]{40}$")
# Unprefixed: scan.py's _is_binary(path) delegates to is_binary_bytes below so
# the live scan and the time-travel reconstruction classify file content
# identically. _TEXT_CHARACTERS stays private — only is_binary_bytes needs it.
BINARY_CHUNK = 8192
_TEXT_CHARACTERS = bytes({7, 8, 9, 10, 11, 12, 13, 27}) + bytes(range(0x20, 0x100))


def _git_argv(root: Path, *args: str) -> list[str]:
    """The `-c safe.directory=* -C <root>` prefix shared by every git
    invocation in this module — the ref-injection guard (`--end-of-options`
    callers add themselves) and the safe.directory bypass (see _run_git's
    docstring in scan.py) live in exactly one place."""
    return ["git", "-c", "safe.directory=*", "-C", str(root), *args]


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        _git_argv(root, *args),
        capture_output=True,
        check=False,
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
    return out if _SHA40.match(out) else None


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
        sha = parts[2]
        size = 0 if parts[3] == "-" else int(parts[3])
        files.append(TreeBlob(path=path, sha=sha, size=size))
    return files


class BlobStats(NamedTuple):
    lines: int
    binary: bool
    media_width: int | None
    media_height: int | None


def is_binary_bytes(chunk: bytes) -> bool:
    head = chunk[:BINARY_CHUNK]
    if not head:
        return False
    if b"\x00" in head:
        return True
    non_text = sum(1 for b in head if b not in _TEXT_CHARACTERS)
    return non_text / len(head) > 0.30


def blob_stats_batch(
    root: Path, shas: list[str], *, media_shas: frozenset[str] = frozenset()
) -> dict[str, BlobStats]:
    """Compute (lines, binary, media dims) for each blob via one
    `cat-file --batch`. Duplicate shas are de-duped; the returned dict is
    keyed by blob sha.

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
    proc = subprocess.run(
        _git_argv(root, "cat-file", "--batch"),
        input="\n".join(unique).encode("ascii"),
        capture_output=True,
        check=False,
    )
    out = proc.stdout
    result: dict[str, BlobStats] = {}
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
        binary = is_binary_bytes(content)
        lines = 0 if binary else content.count(b"\n")
        mw, mh = (
            probe_media_dims_from_bytes(content) if sha in media_shas else (None, None)
        )
        result[sha] = BlobStats(
            lines=lines, binary=binary, media_width=mw, media_height=mh
        )
    return result
