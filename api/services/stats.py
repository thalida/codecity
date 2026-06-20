"""Per-repo derived stats (the Overview "almanac" superlatives + min/max
ranges), computed once at manifest-wrap over the in-memory tree + commits.
Pure: no I/O. The web app reads these instead of re-walking the tree."""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any, Callable, Iterator, Optional, cast

from api.services.manifest_types import (
    AuthorStat,
    CommitEntry,
    CommitLeader,
    DayLeader,
    DirLeader,
    DirNode,
    FileLeader,
    FileNode,
    RangeStat,
    RepoStats,
)


def _iter_files(node: DirNode) -> Iterator[FileNode]:
    for child in node["children"]:
        if child["type"] == "file":
            yield child  # type: ignore[misc]
        else:
            yield from _iter_files(child)  # type: ignore[arg-type]


def _iter_dirs(node: DirNode) -> Iterator[DirNode]:
    # descendant directories, NOT the passed-in root
    for child in node["children"]:
        if child["type"] == "directory":
            yield child  # type: ignore[misc]
            yield from _iter_dirs(child)  # type: ignore[arg-type]


def _pick(items: Any, key: Callable[[Any], Any]) -> Any:
    """Item maximizing key(item); None for empty / all-None keys; first-seen ties."""
    best = None
    best_k = None
    for it in items:
        k = key(it)
        if k is None:
            continue
        if best_k is None or k > best_k:
            best_k, best = k, it
    return best


def _range(values: list[int]) -> RangeStat:
    # {0,0} is the empty-pool sentinel — callers treat it as "no range yet".
    return {"min": min(values), "max": max(values)} if values else {"min": 0, "max": 0}


def _file_leader(f: Optional[FileNode]) -> FileLeader | None:
    if f is None:
        return None
    out: dict[str, Any] = {
        "path": f["path"],
        "lines": f["lines"],
        "bytes": f["size"],
        "created": f["created"],
        "modified": f["modified"],
    }
    if "media_width" in f and "media_height" in f:
        out["media_width"] = f["media_width"]
        out["media_height"] = f["media_height"]
    return cast(FileLeader, out)


def _depth(p: str) -> int:
    return p.count("/") + 1 if p else 0


def _dir_leader(d: Optional[DirNode]) -> DirLeader | None:
    if d is None:
        return None
    return {
        "path": d["path"],
        "depth": _depth(d["path"]),
        "file_count": d["descendants_file_count"],
    }


def _media_pixels(f: FileNode) -> Optional[int]:
    mw = f.get("media_width")  # type: ignore[attr-defined]
    mh = f.get("media_height")  # type: ignore[attr-defined]
    # Both dims present → pixel area (a 0 dim ranks lowest, not as missing data);
    # either absent → None so _pick skips this file.
    if mw is not None and mh is not None:
        return mw * mh
    return None


def _longest_streak(dates: list[str]) -> int:
    uniq = sorted(set(dates))
    if not uniq:
        return 0
    best = run = 1
    for i in range(1, len(uniq)):
        if (date.fromisoformat(uniq[i]) - date.fromisoformat(uniq[i - 1])).days == 1:
            run += 1
            best = max(best, run)
        else:
            run = 1
    return best


def compute_repo_stats(tree: DirNode, commits: list[CommitEntry]) -> RepoStats:
    files = list(_iter_files(tree))
    nonmedia: list[FileNode] = [f for f in files if f["mediaKind"] is None]
    text: list[FileNode] = [f for f in nonmedia if not f["binary"] and f["lines"] > 0]
    media: list[FileNode] = [f for f in files if f["mediaKind"] is not None]
    dirs = list(_iter_dirs(tree))

    grandest: CommitEntry | None = _pick(commits, lambda c: c["files"])
    sparsest: CommitEntry | None = _pick(commits, lambda c: -c["files"])

    busiest_day: DayLeader | None = None
    if commits:
        # Each commit row carries its date's full same_day_total, so max() per date
        # deduplicates instead of multi-counting.
        day_totals: dict[str, int] = {}
        for c in commits:
            d = c["date"]
            # same_day_total is NotRequired (absent in cached raw entries before
            # annotation); by manifest-wrap it is always present — use .get with
            # a safe default so pyright doesn't flag the NotRequired access.
            total = c.get("same_day_total", 1)  # type: ignore[misc]
            day_totals[d] = max(day_totals.get(d, 0), total)
        best_date, best_count = max(day_totals.items(), key=lambda kv: kv[1])
        busiest_day = {"date": best_date, "count": best_count}

    author_counts = Counter(a for c in commits for a in c["authors"])
    authors: list[AuthorStat] = [
        {"name": name, "commits": n}
        for name, n in sorted(author_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    grandest_commit: CommitLeader | None = (
        {"sha": grandest["sha"], "files": grandest["files"]} if grandest else None
    )
    sparsest_commit: CommitLeader | None = (
        {"sha": sparsest["sha"], "files": sparsest["files"]} if sparsest else None
    )

    return {
        # Project line/byte ranges for building-size normalization. Over ALL
        # files with non-zero values (matching the old client computeFileStats
        # exactly so the world renders identically) — media included for bytes,
        # zero-line/zero-byte files excluded so the frontend's log/sqrt never
        # sees 0. {0,0} when none (the frontend treats that as the empty range).
        "fileLines": _range([f["lines"] for f in files if f["lines"] > 0]),
        "fileBytes": _range([f["size"] for f in files if f["size"] > 0]),
        "oldestFile": _file_leader(
            min(nonmedia, key=lambda f: f["created"], default=None)
        ),
        "newestFile": _file_leader(_pick(nonmedia, lambda f: f["created"])),
        "freshestFile": _file_leader(_pick(nonmedia, lambda f: f["modified"])),
        "stalestFile": _file_leader(
            min(nonmedia, key=lambda f: f["modified"], default=None)
        ),
        "tallestFile": _file_leader(_pick(text, lambda f: f["lines"])),
        "shortestFile": _file_leader(_pick(text, lambda f: -f["lines"])),
        "widestFile": _file_leader(_pick(nonmedia, lambda f: f["size"])),
        "narrowestFile": _file_leader(_pick(nonmedia, lambda f: -f["size"])),
        "largestMedia": _file_leader(_pick(media, lambda f: f["size"])),
        "sharpestMedia": _file_leader(_pick(media, _media_pixels)),
        "mediaCount": len(media),
        "deepestDir": _dir_leader(_pick(dirs, lambda d: _depth(d["path"]))),
        "biggestDir": _dir_leader(_pick(dirs, lambda d: d["descendants_file_count"])),
        "grandestCommit": grandest_commit,
        "sparsestCommit": sparsest_commit,
        "busiestDay": busiest_day,
        "longestStreakDays": _longest_streak([c["date"] for c in commits]),
        "authors": authors,
    }
