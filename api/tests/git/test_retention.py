"""clones/ retention: a byte budget, least-recently-used first.

Unlike the derived caches, a clone is expensive to lose and unsafe to delete
while a scan reads it, so these cover the ordering and the accounting; the
"startup only" half is enforced by where it is called from, not here.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from api.git.retention import (
    _dir_bytes,
    _usage_path,
    record_clone_use,
    sweep_clones_to_budget,
)


def _clone(root: Path, name: str, size: int, *, last_used: float | None = None) -> Path:
    clone = root / name
    (clone / ".git").mkdir(parents=True)
    (clone / "big.bin").write_bytes(b"x" * size)
    if last_used is not None:
        _usage_path(clone).write_text(
            json.dumps({"last_used": last_used, "bytes": _dir_bytes(clone)})
        )
    return clone


def test_nothing_is_evicted_under_budget(tmp_path: Path) -> None:
    clones = tmp_path / "clones"
    clones.mkdir()
    keep = _clone(clones, "a", 1000, last_used=time.time())

    assert sweep_clones_to_budget(clones, budget=1_000_000) == 0
    assert keep.exists()


def test_evicts_least_recently_used_first(tmp_path: Path) -> None:
    """The one nobody has opened longest goes, not the oldest on disk: a fetch
    touches a directory without anyone ever having looked at the city."""
    clones = tmp_path / "clones"
    clones.mkdir()
    now = time.time()
    stale = _clone(clones, "stale", 4000, last_used=now - 86_400)
    fresh = _clone(clones, "fresh", 4000, last_used=now)

    deleted = sweep_clones_to_budget(clones, budget=5000)

    assert deleted == 1
    assert not stale.exists()
    assert fresh.exists()


def test_an_unrecorded_clone_goes_before_a_used_one(tmp_path: Path) -> None:
    """No usage record means no evidence anyone opened it. Keeping it on that
    basis would keep everything: nothing recorded use before this existed."""
    clones = tmp_path / "clones"
    clones.mkdir()
    unrecorded = _clone(clones, "unrecorded", 4000)
    used = _clone(clones, "used", 4000, last_used=time.time() - 999_999)

    sweep_clones_to_budget(clones, budget=5000)

    assert not unrecorded.exists()
    assert used.exists()


def test_a_swept_clone_is_measured_and_recorded_once(tmp_path: Path) -> None:
    """The sweep stamps what it measures, so a clone it spares is not re-walked
    on every startup for the rest of its life."""
    clones = tmp_path / "clones"
    clones.mkdir()
    clone = _clone(clones, "a", 2000)
    assert not _usage_path(clone).exists()

    sweep_clones_to_budget(clones, budget=1_000_000)

    recorded = json.loads(_usage_path(clone).read_text())
    assert recorded["bytes"] >= 2000
    assert recorded["last_used"] == 0.0  # measured, never used


def test_use_is_recorded_with_a_real_size(tmp_path: Path) -> None:
    clones = tmp_path / "clones"
    clones.mkdir()
    clone = _clone(clones, "a", 3000)

    before = time.time()
    record_clone_use(clone)

    recorded = json.loads(_usage_path(clone).read_text())
    assert recorded["last_used"] >= before
    assert recorded["bytes"] >= 3000


def test_it_stops_as_soon_as_it_fits(tmp_path: Path) -> None:
    """Every eviction costs a re-clone, so the sweep takes the fewest it can."""
    clones = tmp_path / "clones"
    clones.mkdir()
    now = time.time()
    for i in range(4):
        _clone(clones, f"c{i}", 4000, last_used=now - (10 - i))

    deleted = sweep_clones_to_budget(clones, budget=9000)

    # 16000 total, budget 9000: two go, the two most recent stay.
    assert deleted == 2
    assert not (clones / "c0").exists() and not (clones / "c1").exists()
    assert (clones / "c2").exists() and (clones / "c3").exists()


def test_a_missing_clones_dir_is_not_an_error(tmp_path: Path) -> None:
    assert sweep_clones_to_budget(tmp_path / "never-cloned") == 0
