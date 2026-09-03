"""Keeping the cache inside a byte budget, across every repo.

The per-family counts in results/manifests.py bound how many entries ONE repo
keeps. They cannot bound disk, for two reasons this sweep exists to fix.

Entry sizes span five orders of magnitude — a manifest for a tiny repo is under
a kilobyte, one measured here was 93MB — so a count says nothing about bytes.
And the family sweep only ever runs against the repo being saved, which means
it tidies the repos in active use and never touches the ones scanned once and
abandoned. A machine measured before this held 845 entries over 688 repos, 385MB
of which every byte was already unreadable after a schema bump.

So: one budget over every derived cache, evicting oldest-first by mtime.
"""

from __future__ import annotations

from pathlib import Path

from api.cache.storage.paths import MANIFEST_EXT, swept_dirs
from api.core.config import CACHE_BUDGET_BYTES

# Only these are swept. Anything else in a cache dir was not written by us.
_SUFFIXES = (".json", MANIFEST_EXT)


def _entries() -> list[tuple[float, int, Path]]:
    """(mtime, size, path) for every swept cache file that still exists.

    In-flight `atomic_write` temporaries are dot-prefixed and end in `.tmp`, so
    they never match and can never be deleted out from under a write.
    """
    out: list[tuple[float, int, Path]] = []
    for directory in swept_dirs():
        if not directory.exists():
            continue
        for path in directory.iterdir():
            if not path.name.endswith(_SUFFIXES) or path.name.startswith("."):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue  # vanished under us; nothing to account for
            out.append((stat.st_mtime, stat.st_size, path))
    return out


def sweep_to_budget(*, protect: Path | None = None, budget: int | None = None) -> int:
    """Delete oldest-first until the cache fits its budget. Returns the count.

    `protect` is never evicted and never counted, so a write larger than the
    whole budget still survives the sweep that follows it — the alternative is
    deleting the entry we were just asked to keep.
    """
    limit = CACHE_BUDGET_BYTES if budget is None else budget
    everything = _entries()
    entries = [e for e in everything if protect is None or e[2] != protect]
    entries.sort(reverse=True)  # newest first; ties break on size then path

    deleted = 0
    # The protected entry is spent before anything else gets a share, so the
    # budget stays a true ceiling instead of one-entry-over.
    running = sum(size for _, size, path in everything if path == protect)
    for _, size, path in entries:
        running += size
        if running <= limit:
            continue
        try:
            path.unlink()
            deleted += 1
        except OSError:
            pass  # still on disk; the next sweep tries again
    return deleted
