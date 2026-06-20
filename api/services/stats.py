"""Per-repo derived stats (the Overview "almanac" superlatives + min/max
ranges), computed once at manifest-wrap over the in-memory tree + commits.
Pure: no I/O. The web app reads these instead of re-walking the tree.
Returns plain dicts; the RepoStats TypedDict is added (and these annotations
tightened) in a later task."""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any, Callable, Iterator, Optional


def _iter_files(node: dict) -> Iterator[dict]:
    for child in node["children"]:
        if child["type"] == "file":
            yield child
        else:
            yield from _iter_files(child)


def _iter_dirs(node: dict) -> Iterator[dict]:
    # descendant directories, NOT the passed-in root
    for child in node["children"]:
        if child["type"] == "directory":
            yield child
            yield from _iter_dirs(child)


def _pick(items: Any, key: Callable[[Any], Any]) -> Optional[dict]:
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


def _range(values: list[int]) -> dict:
    return {"min": min(values), "max": max(values)} if values else {"min": 0, "max": 0}


def _file_leader(f: Optional[dict]) -> Optional[dict]:
    if f is None:
        return None
    out = {
        "path": f["path"],
        "lines": f["lines"],
        "bytes": f["size"],
        "created": f["created"],
        "modified": f["modified"],
    }
    if "media_width" in f and "media_height" in f:
        out["media_width"] = f["media_width"]
        out["media_height"] = f["media_height"]
    return out


def _depth(p: str) -> int:
    return p.count("/") + 1 if p else 0


def _dir_leader(d: Optional[dict]) -> Optional[dict]:
    if d is None:
        return None
    return {
        "path": d["path"],
        "depth": _depth(d["path"]),
        "file_count": d["descendants_file_count"],
    }


def _media_pixels(f: dict) -> Optional[int]:
    mw, mh = f.get("media_width"), f.get("media_height")
    return mw * mh if mw and mh else None


def _neg_iso(s: str) -> tuple[int, ...]:
    # ISO strings sort lexically; invert so _pick (a max-picker) selects the MIN.
    return tuple(-ord(c) for c in s)


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


def compute_repo_stats(tree: dict, commits: list[dict]) -> dict:
    files = list(_iter_files(tree))
    nonmedia = [f for f in files if f["mediaKind"] is None]
    text = [f for f in nonmedia if not f["binary"] and f["lines"] > 0]
    media = [f for f in files if f["mediaKind"] is not None]
    dirs = list(_iter_dirs(tree))

    grandest = _pick(commits, lambda c: c["files"])
    sparsest = _pick(commits, lambda c: -c["files"])

    busiest_day = None
    if commits:
        # same_day_total is the canonical per-date commit count; use max per date
        # in case multiple entries share the same date (deduplicate first).
        day_totals: dict[str, int] = {}
        for c in commits:
            d = c["date"]
            day_totals[d] = max(day_totals.get(d, 0), c["same_day_total"])
        best_date, best_count = max(day_totals.items(), key=lambda kv: kv[1])
        busiest_day = {"date": best_date, "count": best_count}

    author_counts = Counter(a for c in commits for a in c["authors"])
    authors = [
        {"name": name, "commits": n}
        for name, n in sorted(author_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    return {
        "fileLines": _range([f["lines"] for f in text]),
        "fileBytes": _range([f["size"] for f in nonmedia]),
        "oldestFile": _file_leader(_pick(nonmedia, lambda f: _neg_iso(f["created"]))),
        "newestFile": _file_leader(_pick(nonmedia, lambda f: f["created"])),
        "freshestFile": _file_leader(_pick(nonmedia, lambda f: f["modified"])),
        "stalestFile": _file_leader(_pick(nonmedia, lambda f: _neg_iso(f["modified"]))),
        "tallestFile": _file_leader(_pick(text, lambda f: f["lines"])),
        "shortestFile": _file_leader(_pick(text, lambda f: -f["lines"])),
        "widestFile": _file_leader(_pick(nonmedia, lambda f: f["size"])),
        "narrowestFile": _file_leader(_pick(nonmedia, lambda f: -f["size"])),
        "largestMedia": _file_leader(_pick(media, lambda f: f["size"])),
        "sharpestMedia": _file_leader(_pick(media, _media_pixels)),
        "mediaCount": len(media),
        "deepestDir": _dir_leader(_pick(dirs, lambda d: _depth(d["path"]))),
        "biggestDir": _dir_leader(_pick(dirs, lambda d: d["descendants_file_count"])),
        "grandestCommit": {"sha": grandest["sha"], "files": grandest["files"]}
        if grandest
        else None,
        "sparsestCommit": {"sha": sparsest["sha"], "files": sparsest["files"]}
        if sparsest
        else None,
        "busiestDay": busiest_day,
        "longestStreakDays": _longest_streak([c["date"] for c in commits]),
        "authors": authors,
    }
