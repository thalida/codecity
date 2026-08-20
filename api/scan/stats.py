"""Per-repo derived stats (the Overview "almanac" superlatives + min/max
ranges), computed once at manifest-wrap over the in-memory tree + commits.
Pure: no I/O. The web app reads these instead of re-walking the tree."""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Optional

from api.models.manifest import (
    AuthorStat,
    BusynessThresholds,
    CommitDateRange,
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
from api.utils.dates import day_of


# ── Commit-day aggregates ────────────────────────────────────────────────────

# Both signals below count commits per calendar day, so the caller counts once
# and hands the result to each.


def commit_day_counts(commits: list[CommitEntry]) -> dict[str, int]:
    """Calendar day → number of commits on that day."""
    per_day: dict[str, int] = {}
    for c in commits:
        day = day_of(c.date)
        per_day[day] = per_day.get(day, 0) + 1
    return per_day


def annotate_same_day_totals(
    commits: list[CommitEntry], day_counts: dict[str, int]
) -> None:
    """In-place: set each commit's same_day_total to the number of commits
    sharing its calendar date. Both the commit pane's badge and the scene
    tree-color read this one field (#35)."""
    for c in commits:
        c.same_day_total = day_counts[day_of(c.date)]


def busyness_thresholds(day_counts: dict[str, int]) -> BusynessThresholds:
    """Repo-relative per-day commit-count thresholds. avg = median commits/day
    (over days with >= 1 commit); busy = 75th percentile, clamped to avg+1 so
    the three bands stay distinct. Both the scene tree-color gradient and the
    commit pane's label read these, so a busy day looks consistent in both.
    Returns {avg:1, busy:1} for an empty history so consumers needn't guard."""
    if not day_counts:
        return BusynessThresholds(avg=1, busy=1)
    counts = sorted(day_counts.values())

    def quantile(p: float) -> int:
        return counts[min(len(counts) - 1, int(len(counts) * p))]

    avg = quantile(0.5)
    return BusynessThresholds(avg=avg, busy=max(quantile(0.75), avg + 1))


def _file_leader(f: Optional[FileNode]) -> FileLeader | None:
    # Leaders are chosen from measured files only, so a None measurement here
    # would be a bug rather than an unmeasurable blob.
    if f is None or f.lines is None or f.size is None:
        return None
    return FileLeader(
        path=f.path,
        lines=f.lines,
        bytes=f.size,
        created=f.created,
        modified=f.modified,
        media_width=f.media_width,
        media_height=f.media_height,
    )


def _depth(p: str) -> int:
    return p.count("/") + 1 if p else 0


def _dir_leader(d: Optional[DirNode]) -> DirLeader | None:
    if d is None:
        return None
    return DirLeader(
        path=d.path,
        depth=_depth(d.path),
        children=d.children_count,
        descendants=d.descendants_count,
        created=d.descendants_created_min,
        modified=d.descendants_modified_max,
    )


def _media_pixels(f: FileNode) -> Optional[int]:
    # Both dims present → pixel area (a 0 dim ranks lowest, not as missing data);
    # either absent → None so the sharpest-media scan skips this file.
    if f.media_width is not None and f.media_height is not None:
        return f.media_width * f.media_height
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
    # One pass per pool, each updating every winner it owns as it goes rather
    # than a separate scan per superlative. First-seen wins ties, via strict >.
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
    # Each byte leader's own measurement, carried beside it the way the pixel
    # leaders already are: a FileNode's size is nullable, these never are.
    largest_media_b = smallest_media_b = None
    largest_binary_b = smallest_binary_b = None
    widest_b = narrowest_b = None
    tallest_l = shortest_l = None
    for f in iter_file_nodes(tree):
        if f.dirty:
            dirty_count += 1
        lines, size = f.lines, f.size
        # A blob the backfill skipped: still a file and still counted as one,
        # but no total or superlative can take it without inventing a number.
        if lines is None or size is None:
            continue
        if lines > 0:
            line_min = lines if line_min is None or lines < line_min else line_min
            line_max = lines if line_max is None or lines > line_max else line_max
        if size > 0:
            byte_min = size if byte_min is None or size < byte_min else byte_min
            byte_max = size if byte_max is None or size > byte_max else byte_max
        if f.mediaKind is not None:
            media_count += 1
            if largest_media_b is None or size > largest_media_b:
                largest_media_b, largest_media = size, f
            if smallest_media_b is None or size < smallest_media_b:
                smallest_media_b, smallest_media = size, f
            px = _media_pixels(f)
            if px is not None:
                if sharpest_px is None or px > sharpest_px:
                    sharpest_px, sharpest_media = px, f
                if coarsest_px is None or px < coarsest_px:
                    coarsest_px, coarsest_media = px, f
            continue
        if f.binary:
            # Their own category, like media: out of the code superlatives, so a
            # giant .db never wins "widest building".
            binary_count += 1
            if largest_binary_b is None or size > largest_binary_b:
                largest_binary_b, largest_binary = size, f
            if smallest_binary_b is None or size < smallest_binary_b:
                smallest_binary_b, smallest_binary = size, f
            continue
        total_lines += lines
        code_bytes += size
        if oldest is None or f.created < oldest.created:
            oldest = f
        if newest is None or f.created > newest.created:
            newest = f
        if freshest is None or f.modified > freshest.modified:
            freshest = f
        if stalest is None or f.modified < stalest.modified:
            stalest = f
        if widest_b is None or size > widest_b:
            widest_b, widest = size, f
        if narrowest_b is None or size < narrowest_b:
            narrowest_b, narrowest = size, f
        if lines > 0:
            if tallest_l is None or lines > tallest_l:
                tallest_l, tallest = lines, f
            if shortest_l is None or lines < shortest_l:
                shortest_l, shortest = lines, f

    # DIRECT children, not descendants — what is literally on that segment.
    # Smallest ties on fewest descendants, favouring genuine leaf streets.
    deepest = biggest = smallest = None
    # Street age = its subtree's oldest creation date. A directory with no dated
    # descendants (empty, or every child undated) can't win either end.
    oldest_dir = newest_dir = None
    for d in iter_dir_nodes(tree):
        if deepest is None or _depth(d.path) > _depth(deepest.path):
            deepest = d
        if biggest is None or d.children_count > biggest.children_count:
            biggest = d
        if smallest is None or (d.children_count, d.descendants_count) < (
            smallest.children_count,
            smallest.descendants_count,
        ):
            smallest = d
        created = d.descendants_created_min
        if created is not None:
            # Every ancestor inherits its oldest descendant's date, so a bare
            # comparison ties the chain. Break deepest — see the README.
            depth = _depth(d.path)
            if oldest_dir is None or (created, -depth) < (
                oldest_dir.descendants_created_min,
                -_depth(oldest_dir.path),
            ):
                oldest_dir = d
            if newest_dir is None or (created, depth) > (
                newest_dir.descendants_created_min,
                _depth(newest_dir.path),
            ):
                newest_dir = d

    grandest = sparsest = None  # commits, by files changed
    oldest_commit = newest_commit = None  # commit-date range
    # The walk yields oldest first, so the ends ARE the leaders. Comparing dates
    # instead would tie on a busy day and keep the first, which is not newest.
    first = commits[0] if commits else None
    last = commits[-1] if commits else None
    author_counts: Counter[str] = Counter()
    day_totals: dict[str, int] = {}  # date → that date's same_day_total
    for c in commits:
        if grandest is None or c.files > grandest.files:
            grandest = c
        if sparsest is None or c.files < sparsest.files:
            sparsest = c
        author_counts.update(c.authors)
        # Each row carries its date's full total, so max() dedupes rather than
        # multi-counting. 0 until manifest-wrap bakes it; read that as 1.
        d = day_of(c.date)
        day_totals[d] = max(day_totals.get(d, 0), c.same_day_total or 1)
        if oldest_commit is None or d < oldest_commit:
            oldest_commit = d
        if newest_commit is None or d > newest_commit:
            newest_commit = d

    busiest_day: DayLeader | None = None
    if day_totals:
        best_date, best_count = max(day_totals.items(), key=lambda kv: kv[1])
        busiest_day = DayLeader(date=best_date, count=best_count)

    authors: list[AuthorStat] = [
        AuthorStat(name=name, commits=n, hue=_author_hue(name))
        for name, n in sorted(author_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    def _range(mn: Optional[int], mx: Optional[int]) -> RangeStat:
        # {0,0} is the empty-pool sentinel — callers treat it as "no range yet".
        return (
            RangeStat(min=mn, max=mx)
            if mn is not None and mx is not None
            else RangeStat(min=0, max=0)
        )

    def _commit_leader(c: Optional[CommitEntry]) -> CommitLeader | None:
        return CommitLeader(sha=c.sha, files=c.files, date=c.date) if c else None

    return RepoStats(
        # NORMALIZATION ranges, not honest min/max — see the README. {0,0} when
        # no non-zero file exists, which the frontend reads as the empty range.
        lineCountRange=_range(line_min, line_max),
        byteSizeRange=_range(byte_min, byte_max),
        oldestCreatedFile=_file_leader(oldest),
        newestCreatedFile=_file_leader(newest),
        newestModifiedFile=_file_leader(freshest),
        oldestModifiedFile=_file_leader(stalest),
        maxLinesFile=_file_leader(tallest),
        minLinesFile=_file_leader(shortest),
        maxBytesFile=_file_leader(widest),
        minBytesFile=_file_leader(narrowest),
        maxMediaBytesFile=_file_leader(largest_media),
        minMediaBytesFile=_file_leader(smallest_media),
        maxMediaPixelsFile=_file_leader(sharpest_media),
        minMediaPixelsFile=_file_leader(coarsest_media),
        maxBinaryBytesFile=_file_leader(largest_binary),
        minBinaryBytesFile=_file_leader(smallest_binary),
        mediaCount=media_count,
        binaryCount=binary_count,
        totalLines=total_lines,
        dirtyFileCount=dirty_count,
        codeBytes=code_bytes,
        maxDepthDir=_dir_leader(deepest),
        maxChildrenDir=_dir_leader(biggest),
        minChildrenDir=_dir_leader(smallest),
        oldestCreatedDir=_dir_leader(oldest_dir),
        newestCreatedDir=_dir_leader(newest_dir),
        maxFilesPerCommit=_commit_leader(grandest),
        minFilesPerCommit=_commit_leader(sparsest),
        oldestCommit=_commit_leader(first),
        newestCommit=_commit_leader(last),
        commitCount=len(commits),
        # YYYY-MM-DD sorts lexically in chronological order, so min/max are exact.
        commitDates=CommitDateRange(oldest=oldest_commit, newest=newest_commit),
        maxCommitsPerDay=busiest_day,
        maxCommitStreakDays=_longest_streak(list(day_totals.keys())),
        authors=authors,
    )
