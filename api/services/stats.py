"""Per-repo derived stats (the Overview "almanac" superlatives + min/max
ranges), computed once at manifest-wrap over the in-memory tree + commits.
Pure: no I/O. The web app reads these instead of re-walking the tree."""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any, Iterator, Optional, cast

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
    # either absent → None so the sharpest-media scan skips this file.
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
    # One pass over files, one over dirs, one over commits — each updates every
    # winner/range/count for that pool as it goes (first-seen wins ties, via
    # strict > / <), instead of a separate scan per superlative.
    line_min = line_max = byte_min = byte_max = None  # non-zero ranges, all files
    media_count = 0
    oldest = newest = freshest = stalest = None  # non-media, by created/modified
    tallest = shortest = None  # text (non-media, non-binary, lines>0), by lines
    widest = narrowest = None  # non-media, by bytes
    largest_media = sharpest_media = None  # media, by bytes / pixels
    sharpest_px = None
    for f in _iter_files(tree):
        lines, size = f["lines"], f["size"]
        if lines > 0:
            line_min = lines if line_min is None or lines < line_min else line_min
            line_max = lines if line_max is None or lines > line_max else line_max
        if size > 0:
            byte_min = size if byte_min is None or size < byte_min else byte_min
            byte_max = size if byte_max is None or size > byte_max else byte_max
        if f["mediaKind"] is not None:
            media_count += 1
            if largest_media is None or size > largest_media["size"]:
                largest_media = f
            px = _media_pixels(f)
            if px is not None and (sharpest_px is None or px > sharpest_px):
                sharpest_px, sharpest_media = px, f
            continue
        if oldest is None or f["created"] < oldest["created"]:
            oldest = f
        if newest is None or f["created"] > newest["created"]:
            newest = f
        if freshest is None or f["modified"] > freshest["modified"]:
            freshest = f
        if stalest is None or f["modified"] < stalest["modified"]:
            stalest = f
        if widest is None or size > widest["size"]:
            widest = f
        if narrowest is None or size < narrowest["size"]:
            narrowest = f
        if not f["binary"] and lines > 0:
            if tallest is None or lines > tallest["lines"]:
                tallest = f
            if shortest is None or lines < shortest["lines"]:
                shortest = f

    deepest = biggest = None
    for d in _iter_dirs(tree):
        if deepest is None or _depth(d["path"]) > _depth(deepest["path"]):
            deepest = d
        if (
            biggest is None
            or d["descendants_file_count"] > biggest["descendants_file_count"]
        ):
            biggest = d

    grandest = sparsest = None  # commits, by files changed
    oldest_commit = newest_commit = None  # commit-date range
    author_counts: Counter[str] = Counter()
    day_totals: dict[str, int] = {}  # date → that date's same_day_total
    for c in commits:
        if grandest is None or c["files"] > grandest["files"]:
            grandest = c
        if sparsest is None or c["files"] < sparsest["files"]:
            sparsest = c
        author_counts.update(c["authors"])
        # Each row carries its date's full same_day_total, so max() per date
        # deduplicates instead of multi-counting. same_day_total is NotRequired
        # (absent in raw cached entries); by manifest-wrap it is always present.
        d = c["date"]
        day_totals[d] = max(day_totals.get(d, 0), c.get("same_day_total", 1))  # type: ignore[misc]
        oldest_commit = (
            d if oldest_commit is None or d < oldest_commit else oldest_commit
        )
        newest_commit = (
            d if newest_commit is None or d > newest_commit else newest_commit
        )

    busiest_day: DayLeader | None = None
    if day_totals:
        best_date, best_count = max(day_totals.items(), key=lambda kv: kv[1])
        busiest_day = {"date": best_date, "count": best_count}

    authors: list[AuthorStat] = [
        {"name": name, "commits": n}
        for name, n in sorted(author_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    def _range(mn: Optional[int], mx: Optional[int]) -> RangeStat:
        # {0,0} is the empty-pool sentinel — callers treat it as "no range yet".
        return (
            {"min": mn, "max": mx}
            if mn is not None and mx is not None
            else {"min": 0, "max": 0}
        )

    def _commit_leader(c: Optional[CommitEntry]) -> CommitLeader | None:
        return {"sha": c["sha"], "files": c["files"]} if c else None

    return {
        # Project line/byte ranges for building-size normalization. Over ALL
        # files with non-zero values (matching the old client computeFileStats
        # exactly so the world renders identically) — media included for bytes,
        # zero-line/zero-byte files excluded so the frontend's log/sqrt never
        # sees 0. {0,0} when none (the frontend treats that as the empty range).
        "fileLines": _range(line_min, line_max),
        "fileBytes": _range(byte_min, byte_max),
        "oldestFile": _file_leader(oldest),
        "newestFile": _file_leader(newest),
        "freshestFile": _file_leader(freshest),
        "stalestFile": _file_leader(stalest),
        "tallestFile": _file_leader(tallest),
        "shortestFile": _file_leader(shortest),
        "widestFile": _file_leader(widest),
        "narrowestFile": _file_leader(narrowest),
        "largestMedia": _file_leader(largest_media),
        "sharpestMedia": _file_leader(sharpest_media),
        "mediaCount": media_count,
        "deepestDir": _dir_leader(deepest),
        "biggestDir": _dir_leader(biggest),
        "grandestCommit": _commit_leader(grandest),
        "sparsestCommit": _commit_leader(sparsest),
        # YYYY-MM-DD sorts lexically in chronological order, so min/max are exact.
        "commitDates": {"oldest": oldest_commit, "newest": newest_commit},
        "busiestDay": busiest_day,
        "longestStreakDays": _longest_streak(list(day_totals.keys())),
        "authors": authors,
    }
