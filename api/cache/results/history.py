"""The per-repo git-history cache.

Keyed by the commit the walk started from, so polling a repo that hasn't moved
doesn't re-walk `git log` every cycle — by far the longest stage of a scan.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from api.cache.storage.paths import git_history_cache_path
from api.cache.storage.store import atomic_write, load_json, str_map
from api.models.manifest import CommitEntry
from api.utils.shas import is_object_sha

VERSION = 15


def _coerce_commit(value: object) -> CommitEntry | None:
    """One cached commit, or None if any field is missing or malformed.

    All-or-nothing: consumers iterate authors and render subject, so a partial
    entry crashes them where a dropped one does not."""
    if not isinstance(value, dict):
        return None
    d = cast(dict[str, object], value)
    date, files = d.get("date"), d.get("files")
    sha, authors, subject = d.get("sha"), d.get("authors"), d.get("subject")
    if not isinstance(date, str) or not isinstance(subject, str):
        return None
    if not isinstance(files, int) or isinstance(files, bool):
        return None
    if not isinstance(sha, str) or not is_object_sha(sha):
        return None
    if not isinstance(authors, list):
        return None
    if not all(isinstance(a, str) for a in cast(list[object], authors)):
        return None
    return CommitEntry(
        date=date,
        files=files,
        sha=sha,
        authors=cast(list[str], authors),
        subject=subject,
        # Not cached: derived at manifest-wrap, which always runs before these
        # are emitted. See git.meta.flush_current.
        same_day_total=0,
    )


def cache_load_git_history(
    abs_root: Path,
    commit_sha: str,
) -> tuple[dict[str, str], dict[str, str], list[CommitEntry]] | None:
    """The cached history for this root at this commit, or None on a miss.

    ``commit_sha`` may be HEAD or any other resolved ref sha."""
    raw = load_json(git_history_cache_path(abs_root), version=VERSION)
    if raw is None or raw.get("commit_sha") != commit_sha:
        return None
    commits_raw = raw.get("commits")
    if not isinstance(commits_raw, list):
        return None
    if not isinstance(raw.get("created"), dict) or not isinstance(
        raw.get("modified"), dict
    ):
        return None
    commits = [c for c in map(_coerce_commit, cast(list[object], commits_raw)) if c]
    return str_map(raw.get("created")), str_map(raw.get("modified")), commits


def cache_save_git_history(
    abs_root: Path,
    commit_sha: str,
    created: dict[str, str],
    modified: dict[str, str],
    commits: list[CommitEntry],
) -> None:
    """Atomically write the git-history cache for this root + commit."""
    payload = {
        "version": VERSION,
        "root": str(abs_root),
        "commit_sha": commit_sha,
        "created": created,
        "modified": modified,
        "commits": [c.model_dump() for c in commits],
    }
    atomic_write(git_history_cache_path(abs_root), json.dumps(payload))
