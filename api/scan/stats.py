"""Per-repo derived stats (the Overview "almanac" superlatives + min/max
ranges), computed once at manifest-wrap over the in-memory tree + commits.
Pure: no I/O. The web app reads these instead of re-walking the tree."""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any, Optional, cast

from api.manifest_types import (
    AuthorStat,
    BusynessThresholds,
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
from api.scan.treebuild import iter_dir_nodes, iter_file_nodes


# ── Commit-day aggregates ────────────────────────────────────────────────────
#
# Both of the derived signals below are per-calendar-day commit counts, so the
# counting pass is done once by the caller and handed to each. `date` carries a
# full timestamp, so the day has to be sliced back out.


def commit_day_counts(commits: list[CommitEntry]) -> dict[str, int]:
    """Calendar day → number of commits on that day."""
    per_day: dict[str, int] = {}
    for c in commits:
        day = c["date"][:10]
        per_day[day] = per_day.get(day, 0) + 1
    return per_day


def annotate_same_day_totals(
    commits: list[CommitEntry], day_counts: dict[str, int]
) -> None:
    """In-place: set each commit's same_day_total to the number of commits
    sharing its calendar date. Both the commit pane's badge and the scene
    tree-color read this one field (#35)."""
    for c in commits:
        c["same_day_total"] = day_counts[c["date"][:10]]


def busyness_thresholds(day_counts: dict[str, int]) -> BusynessThresholds:
    """Repo-relative per-day commit-count thresholds. avg = median commits/day
    (over days with >= 1 commit); busy = 75th percentile, clamped to avg+1 so
    the three bands stay distinct. Both the scene tree-color gradient and the
    commit pane's label read these, so a busy day looks consistent in both.
    Returns {avg:1, busy:1} for an empty history so consumers needn't guard."""
    if not day_counts:
        return {"avg": 1, "busy": 1}
    counts = sorted(day_counts.values())

    def quantile(p: float) -> int:
        return counts[min(len(counts) - 1, int(len(counts) * p))]

    avg = quantile(0.5)
    return {"avg": avg, "busy": max(quantile(0.75), avg + 1)}


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
        "children": d["children_count"],
        "descendants": d["descendants_count"],
        "created": d["descendants_created_min"],
        "modified": d["descendants_modified_max"],
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


def _author_hue(name: str) -> int:
    """FNV-1a over the name's UTF-8 bytes, mod 360. The & 0xFFFFFFFF keeps the
    hash in 32-bit unsigned range; widening it would repaint every author."""
    h = 0x811C9DC5
    for byte in name.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % 360


def compute_repo_stats(tree: DirNode, commits: list[CommitEntry]) -> RepoStats:
    # One pass over files, one over dirs, one over commits — each updates every
    # winner/range/count for that pool as it goes (first-seen wins ties, via
    # strict > / <), instead of a separate scan per superlative.
    line_min = line_max = byte_min = byte_max = None  # non-zero ranges, all files
    media_count = binary_count = 0
    dirty_count = 0
    total_lines = code_bytes = 0  # sums over code files only (for overview averages)
    oldest = newest = freshest = stalest = None  # code files, by created/modified
    tallest = shortest = None  # code files (lines>0), by lines
    widest = narrowest = None  # code files, by bytes
    largest_media = smallest_media = None  # media, by bytes
    sharpest_media = coarsest_media = None  # media, by pixels (most / fewest)
    sharpest_px = coarsest_px = None
    largest_binary = smallest_binary = None  # binary/data files, by bytes
    for f in iter_file_nodes(tree):
        if f["dirty"]:
            dirty_count += 1
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
            if smallest_media is None or size < smallest_media["size"]:
                smallest_media = f
            px = _media_pixels(f)
            if px is not None:
                if sharpest_px is None or px > sharpest_px:
                    sharpest_px, sharpest_media = px, f
                if coarsest_px is None or px < coarsest_px:
                    coarsest_px, coarsest_media = px, f
            continue
        if f["binary"]:
            # Binary files are their own "data" category (like media): they get
            # their own size leaders and stay OUT of the code superlatives, so a
            # giant .db never wins "widest building".
            binary_count += 1
            if largest_binary is None or size > largest_binary["size"]:
                largest_binary = f
            if smallest_binary is None or size < smallest_binary["size"]:
                smallest_binary = f
            continue
        total_lines += lines
        code_bytes += size
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
        if lines > 0:
            if tallest is None or lines > tallest["lines"]:
                tallest = f
            if shortest is None or lines < shortest["lines"]:
                shortest = f

    # Street size = DIRECT children (what's literally on that street segment),
    # not total descendants. Smallest breaks ties by fewest descendants, so it
    # favours genuine leaf streets over a one-child dir that fans out below.
    deepest = biggest = smallest = None
    # Street age = its subtree's oldest creation date. A directory with no dated
    # descendants (empty, or every child undated) can't win either end.
    oldest_dir = newest_dir = None
    for d in iter_dir_nodes(tree):
        if deepest is None or _depth(d["path"]) > _depth(deepest["path"]):
            deepest = d
        if biggest is None or d["children_count"] > biggest["children_count"]:
            biggest = d
        if smallest is None or (d["children_count"], d["descendants_count"]) < (
            smallest["children_count"],
            smallest["descendants_count"],
        ):
            smallest = d
        created = d["descendants_created_min"]
        if created is not None:
            # Every ancestor inherits its oldest descendant's date, so a bare
            # date comparison ties the whole chain and the shallowest wins by
            # iteration order. Break toward the deepest: the street that
            # actually holds the file, not each parent that contains it.
            depth = _depth(d["path"])
            if oldest_dir is None or (created, -depth) < (
                oldest_dir["descendants_created_min"],
                -_depth(oldest_dir["path"]),
            ):
                oldest_dir = d
            if newest_dir is None or (created, depth) > (
                newest_dir["descendants_created_min"],
                _depth(newest_dir["path"]),
            ):
                newest_dir = d

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
        d = c["date"][:10]  # calendar day: `date` carries a full timestamp
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
        {"name": name, "commits": n, "hue": _author_hue(name)}
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
        # files with non-zero values (matching the client's computeFileStats
        # exactly so the world renders identically) — media included for bytes,
        # zero-line/zero-byte files excluded so the frontend's log/sqrt never
        # sees 0. {0,0} when none (the frontend treats that as the empty range).
        "lineCountRange": _range(line_min, line_max),
        "byteSizeRange": _range(byte_min, byte_max),
        "oldestCreatedFile": _file_leader(oldest),
        "newestCreatedFile": _file_leader(newest),
        "newestModifiedFile": _file_leader(freshest),
        "oldestModifiedFile": _file_leader(stalest),
        "maxLinesFile": _file_leader(tallest),
        "minLinesFile": _file_leader(shortest),
        "maxBytesFile": _file_leader(widest),
        "minBytesFile": _file_leader(narrowest),
        "maxMediaBytesFile": _file_leader(largest_media),
        "minMediaBytesFile": _file_leader(smallest_media),
        "maxMediaPixelsFile": _file_leader(sharpest_media),
        "minMediaPixelsFile": _file_leader(coarsest_media),
        "maxBinaryBytesFile": _file_leader(largest_binary),
        "minBinaryBytesFile": _file_leader(smallest_binary),
        "mediaCount": media_count,
        "binaryCount": binary_count,
        "totalLines": total_lines,
        "dirtyFileCount": dirty_count,
        "codeBytes": code_bytes,
        "maxDepthDir": _dir_leader(deepest),
        "maxChildrenDir": _dir_leader(biggest),
        "minChildrenDir": _dir_leader(smallest),
        "oldestCreatedDir": _dir_leader(oldest_dir),
        "newestCreatedDir": _dir_leader(newest_dir),
        "maxFilesPerCommit": _commit_leader(grandest),
        "minFilesPerCommit": _commit_leader(sparsest),
        "commitCount": len(commits),
        # YYYY-MM-DD sorts lexically in chronological order, so min/max are exact.
        "commitDates": {"oldest": oldest_commit, "newest": newest_commit},
        "maxCommitsPerDay": busiest_day,
        "maxCommitStreakDays": _longest_streak(list(day_totals.keys())),
        "authors": authors,
    }
