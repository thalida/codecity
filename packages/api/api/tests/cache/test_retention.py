"""The byte budget that bounds the cache across every repo."""

from __future__ import annotations

import os
from pathlib import Path

from api.cache.storage import paths as cache_paths
from api.cache.storage.retention import sweep_to_budget


def _write(path: Path, size: int, *, age: float) -> Path:
    """A cache file of `size` bytes, `age` seconds old. Ages are explicit
    because eviction is by mtime and a whole test would otherwise race the
    one-second resolution of a real clock."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    stamp = 1_000_000.0 - age
    os.utime(path, (stamp, stamp))
    return path


def _manifest(name: str, size: int, age: float) -> Path:
    return _write(cache_paths.manifest_dir() / f"{name}.json.gz", size, age=age)


def test_evicts_oldest_first_until_it_fits(redirect_cache_root) -> None:
    new = _manifest("repo__new", 100, age=1)
    mid = _manifest("repo__mid", 100, age=100)
    old = _manifest("repo__old", 100, age=1000)

    assert sweep_to_budget(budget=250) == 1
    assert new.exists() and mid.exists()
    assert not old.exists()


def test_a_budget_that_fits_deletes_nothing(redirect_cache_root) -> None:
    kept = [_manifest(f"repo__{i}", 100, age=i) for i in range(3)]

    assert sweep_to_budget(budget=10_000) == 0
    assert all(p.exists() for p in kept)


def test_sweeps_repos_other_than_the_one_being_saved(redirect_cache_root) -> None:
    """The whole point of the budget pass: the per-family counts only ever run
    against the root being written, so a repo scanned once and abandoned was
    never reachable."""
    mine = _manifest("mine__sig", 100, age=1)
    theirs = _manifest("theirs__sig", 100, age=500)

    sweep_to_budget(budget=150, protect=mine)
    assert mine.exists()
    assert not theirs.exists()


def test_protected_entry_survives_a_budget_it_alone_exceeds(
    redirect_cache_root,
) -> None:
    """Deleting the entry we were just asked to keep would make the save a
    no-op, so the budget yields to it."""
    just_written = _manifest("repo__huge", 5000, age=0)

    sweep_to_budget(budget=100, protect=just_written)
    assert just_written.exists()


def test_sweeps_every_derived_cache_not_just_manifests(redirect_cache_root) -> None:
    root = redirect_cache_root
    stale_history = _write(root / "git-history" / "old.json", 400, age=900)
    fresh_blobs = _write(root / "blobs" / "new.json", 100, age=1)

    sweep_to_budget(budget=200)
    assert fresh_blobs.exists()
    assert not stale_history.exists()


def test_never_touches_clones(redirect_cache_root) -> None:
    """A clone costs a re-clone rather than a re-read, and one may be in use by
    a running scan. git/clone.py owns that directory."""
    clone = _write(redirect_cache_root / "clones" / "abc.json", 9000, age=999)

    sweep_to_budget(budget=1)
    assert clone.exists()


def test_never_touches_an_in_flight_write(redirect_cache_root) -> None:
    """atomic_write's temporaries are dot-prefixed and suffixed .tmp. Deleting
    one would break the rename it is waiting on."""
    tmp = _write(
        cache_paths.manifest_dir() / ".repo__sig.json.gz.abc123.tmp", 9000, age=999
    )

    sweep_to_budget(budget=1)
    assert tmp.exists()
