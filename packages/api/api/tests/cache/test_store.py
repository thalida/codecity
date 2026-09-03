"""The read-returns-None rule: a cache file that is gone, truncated, or
written by older code must miss rather than raise."""

from __future__ import annotations

import gzip
import json

import pytest

from api import cache as cache_mod
from api.cache.results import manifests as cache_manifests
from api.cache.storage import paths as cache_paths
from api.tests.conftest import make_timeline_bundle
from api.tests.cache._helpers import _ROOT, _SHA, _SIG, _stub_manifest


def _seed_files() -> tuple:
    cache_mod.cache_save_files(_ROOT, {})
    path = cache_paths.CACHE_ROOT / "files" / f"{cache_paths.repo_key(_ROOT)}.json"
    # Well-formed, so the version guard is the only thing that can reject it —
    # a malformed one would be dropped by the entry filter instead.
    stale = {
        "version": 999,
        "root": str(_ROOT),
        "entries": {
            "a.py": {"size": 1, "mtime": 1.0, "lines": 1, "binary": False, "ext": ".py"}
        },
    }
    return path, lambda: cache_mod.cache_load_files(_ROOT), {}, False, stale


def _seed_git_history() -> tuple:
    cache_mod.cache_save_git_history(_ROOT, "abc", {}, {}, [])
    path = (
        cache_paths.CACHE_ROOT / "git-history" / f"{cache_paths.repo_key(_ROOT)}.json"
    )
    stale = {
        "version": 999,
        "root": str(_ROOT),
        "commit_sha": "abc",
        "created": {},
        "modified": {},
    }
    return (
        path,
        lambda: cache_mod.cache_load_git_history(_ROOT, "abc"),
        None,
        False,
        stale,
    )


def _seed_manifest() -> tuple:
    cache_mod.cache_save_manifest(_ROOT, _SIG, _stub_manifest())
    path = cache_paths.manifest_cache_path(_ROOT, _SIG)
    stale = {"version": 999, "manifest": {}}
    return path, lambda: cache_mod.cache_load_manifest(_ROOT, _SIG), None, True, stale


def _seed_timeline() -> tuple:
    bundle = make_timeline_bundle(unionManifest=_stub_manifest())
    cache_mod.cache_save_timeline(_ROOT, _SHA, bundle)
    path = cache_paths.timeline_cache_path(_ROOT, _SHA, frozenset())
    # One version back, not 999: serving the previous shape would hand the
    # scrubber day-precision dates and stack every same-day commit.
    stale = {
        "version": cache_manifests.TIMELINE_VERSION - 1,
        "bundle": bundle.model_dump(),
    }
    return path, lambda: cache_mod.cache_load_timeline(_ROOT, _SHA), None, True, stale


# Every cache read is best-effort: a file that is gone, truncated, or written by
# older code has to miss, never raise, or a stale cache bricks the scan.
@pytest.mark.parametrize(
    "seed",
    [_seed_files, _seed_git_history, _seed_manifest, _seed_timeline],
    ids=["files", "git-history", "manifest", "timeline"],
)
@pytest.mark.parametrize("damage", ["missing", "truncated", "stale-version"])
def test_damaged_cache_reads_miss(redirect_cache_root, seed, damage) -> None:
    path, load, empty, gzipped, stale = seed()
    path.parent.mkdir(parents=True, exist_ok=True)

    if damage == "missing":
        path.unlink(missing_ok=True)
    elif damage == "truncated":
        path.write_bytes(b"{not valid, and definitely not gzip")
    else:
        payload = json.dumps(stale).encode("utf-8")
        if gzipped:
            with gzip.open(path, "wb") as fh:
                fh.write(payload)
        else:
            path.write_bytes(payload)

    assert load() == empty
