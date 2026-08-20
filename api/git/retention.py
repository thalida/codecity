"""Keeping clones/ inside a byte budget.

Every other cache is safe to delete at any moment: a reader that finds an entry
gone returns None and rebuilds. A clone is not — `scan_tree` walks that
directory for the whole duration of a scan, and nothing tracks which clones are
being read. So this runs at startup, before the server accepts a request, and
nowhere else. That makes "is anyone using this one" a question that cannot
arise, rather than one answered by machinery that has to survive a crash.

Cost is the other difference. Evicting a manifest costs a re-read; evicting an
8GB clone costs minutes and a network round trip. Hence a separate budget from
CACHE_BUDGET_BYTES, and least-recently-USED order rather than oldest-written.
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from api.core.config import CLONE_BUDGET_BYTES
from api.core.progress import log

# Inside .git/, beside the hydrate marker. Directory mtime is no substitute:
# see README.md.
_USAGE_FILE = "codecity-usage.json"


def _usage_path(clone: Path) -> Path:
    return clone / ".git" / _USAGE_FILE


def record_clone_use(clone: Path) -> None:
    """Stamp a clone as used, now, with what it currently costs on disk.

    Written where the work already is (after a clone or fetch), so the sweep
    never has to measure a clone that has been used since it last ran."""
    try:
        _usage_path(clone).write_text(
            json.dumps({"last_used": time.time(), "bytes": _dir_bytes(clone)})
        )
    except OSError:
        pass  # a clone we can't stamp is one the sweep will re-measure


def _read_usage(clone: Path) -> tuple[float, int]:
    """(last_used, bytes) for a clone, measuring and recording if it has never
    been stamped. An unstamped clone reads as never used: there is no evidence
    anyone opened it, and the first scan that does re-stamps it."""
    try:
        raw = json.loads(_usage_path(clone).read_text())
        return float(raw["last_used"]), int(raw["bytes"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    size = _dir_bytes(clone)
    try:
        _usage_path(clone).write_text(json.dumps({"last_used": 0.0, "bytes": size}))
    except OSError:
        pass
    return 0.0, size


def _dir_bytes(root: Path) -> int:
    """Bytes on disk under `root`. Walked, not asked of git: `count-objects`
    sees the object store and misses the working tree, which is most of it."""
    total = 0
    for path in root.rglob("*"):
        try:
            if path.is_file() and not path.is_symlink():
                total += path.stat().st_size
        except OSError:
            continue
    return total


def sweep_clones_to_budget(clones_dir: Path, *, budget: int | None = None) -> int:
    """Delete least-recently-used clones until clones/ fits its budget, and
    return how many went. STARTUP ONLY: deleting a clone mid-scan breaks the
    scan reading it, and nothing here can tell whether one is."""
    limit = CLONE_BUDGET_BYTES if budget is None else budget
    if not clones_dir.is_dir():
        return 0

    entries = [
        (*_read_usage(clone), clone)
        for clone in sorted(clones_dir.iterdir())
        if clone.is_dir()
    ]
    total = sum(size for _, size, _ in entries)
    if total <= limit:
        return 0

    # Least recently used first; among never-used clones the biggest goes first,
    # so the fewest deletions reclaim the most.
    entries.sort(key=lambda e: (e[0], -e[1]))
    deleted = 0
    for _, size, clone in entries:
        if total <= limit:
            break
        try:
            shutil.rmtree(clone)
        except OSError:
            continue  # still there; the next startup tries again
        total -= size
        deleted += 1
        log(f"evicted clone {clone.name} ({size // 1024**2}MB)")
    if deleted:
        log(f"clones now {total // 1024**2}MB, budget {limit // 1024**2}MB")
    return deleted
