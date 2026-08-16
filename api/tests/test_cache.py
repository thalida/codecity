"""Unit tests for api/cache.py."""

from __future__ import annotations

import gzip
import json
import os
import unittest
from pathlib import Path

import pytest

from api import cache as cache_mod
from api.cache import _git_history_cache_path
from api.models.manifest import CommitEntry, Manifest, TimelineBundle
from api.tests.conftest import make_commit, make_manifest, make_timeline_bundle


_ROOT = Path("/some/repo")
_SIG = "a" * 32
_SHA = "a" * 40


def _stub_manifest():
    return make_manifest(str(_ROOT))


def _seed_files() -> tuple:
    cache_mod.cache_save_files(_ROOT, {})
    path = cache_mod.CACHE_ROOT / "files" / f"{cache_mod.repo_key(_ROOT)}.json"
    # A well-formed entry, so the version guard is the only thing that can
    # reject it. A malformed one would be dropped by the entry filter instead,
    # and the assertion could not tell the two apart.
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
    path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(_ROOT)}.json"
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
    path = cache_mod._manifest_cache_path(_ROOT, _SIG)
    stale = {"version": 999, "manifest": {}}
    return path, lambda: cache_mod.cache_load_manifest(_ROOT, _SIG), None, True, stale


def _seed_timeline() -> tuple:
    bundle = make_timeline_bundle(unionManifest=_stub_manifest())
    cache_mod.cache_save_timeline(_ROOT, _SHA, bundle)
    path = cache_mod._timeline_cache_path(_ROOT, _SHA, frozenset())
    # One version back, not 999: v6 added blobSizes and full commit timestamps,
    # so serving a v5 blob would hand the scrubber day-precision dates and stack
    # every same-day commit.
    stale = {
        "version": cache_mod._TIMELINE_CACHE_VERSION - 1,
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


class CacheTestBase(unittest.TestCase):
    """Base that pulls in the ``redirect_cache_root`` conftest fixture so
    tests don't touch ``~/.cache/codecity/`` and don't leak CACHE_ROOT
    mutations across tests.

    Autouse fixtures *do* run for unittest.TestCase subclasses (unlike
    parameter-injected fixtures), so this is the canonical bridge."""

    @pytest.fixture(autouse=True)
    def _redirect_cache_root(self, redirect_cache_root: Path) -> None:
        # Exposed for tests that want the per-test cache dir.
        self.cache_root = redirect_cache_root


class RepoKeyTests(CacheTestBase):
    def test_stable(self) -> None:
        self.assertEqual(
            cache_mod.repo_key(Path("/foo/bar")),
            cache_mod.repo_key(Path("/foo/bar")),
        )

    def test_distinct(self) -> None:
        self.assertNotEqual(
            cache_mod.repo_key(Path("/foo/bar")),
            cache_mod.repo_key(Path("/foo/baz")),
        )

    def test_short_hex(self) -> None:
        # 16 hex chars — long enough to be unique, short enough to be readable.
        k = cache_mod.repo_key(Path("/foo/bar"))
        self.assertEqual(len(k), 16)
        int(k, 16)  # raises if not hex


class FileCacheTests(CacheTestBase):
    def test_roundtrip(self) -> None:
        root = Path("/some/repo")
        entries = {
            "src/foo.py": {
                "size": 1234,
                "mtime": 1715000000.0,
                "lines": 42,
                "binary": False,
                "ext": ".py",
            },
        }
        cache_mod.cache_save_files(root, entries)
        self.assertEqual(cache_mod.cache_load_files(root), entries)

    def test_atomic_write_no_temp_left_behind(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_files(
            root,
            {"a": {"size": 0, "mtime": 0.0, "lines": 0, "binary": False, "ext": ""}},
        )
        files_dir = cache_mod.CACHE_ROOT / "files"
        leftovers = [p for p in files_dir.iterdir() if p.suffix == ".tmp"]
        self.assertEqual(leftovers, [])

    def test_load_drops_malformed_entries(self) -> None:
        # Mix valid and invalid entries; valid ones survive, invalid ones drop.
        root = Path("/some/repo")
        cache_mod.cache_save_files(root, {})
        path = cache_mod.CACHE_ROOT / "files" / f"{cache_mod.repo_key(root)}.json"
        payload = {
            "version": cache_mod._FILE_CACHE_VERSION,
            "root": str(root),
            "entries": {
                "good.py": {
                    "size": 1,
                    "mtime": 1.0,
                    "lines": 1,
                    "binary": False,
                    "ext": ".py",
                },
                "missing-fields.py": {"size": 1},  # incomplete
                "wrong-type.py": {
                    "size": "not-an-int",
                    "mtime": 1.0,
                    "lines": 1,
                    "binary": False,
                    "ext": ".py",
                },
                "not-a-dict.py": "garbage",
            },
        }
        path.write_text(json.dumps(payload))
        loaded = cache_mod.cache_load_files(root)
        self.assertIn("good.py", loaded)
        self.assertNotIn("missing-fields.py", loaded)
        self.assertNotIn("wrong-type.py", loaded)
        self.assertNotIn("not-a-dict.py", loaded)


class GitHistoryCacheTests(CacheTestBase):
    def test_hit_on_matching_head(self) -> None:
        root = Path("/some/repo")
        created = {"src/a.py": "2024-01-01T00:00:00Z"}
        modified = {"src/a.py": "2024-06-01T00:00:00Z"}
        cache_mod.cache_save_git_history(root, "abc123", created, modified, [])
        result = cache_mod.cache_load_git_history(root, "abc123")
        self.assertEqual(result, (created, modified, []))

    def test_round_trips_full_commit_entries(self) -> None:
        # The loader must reconstruct the WHOLE CommitEntry — authors +
        # subject included. A previous bug dropped them, so commits loaded
        # from a warm cache had no `authors`, crashing the fireflies
        # consumer (`for author of c.authors`). Round-trip a populated commit.
        root = Path("/some/repo")
        commits = [
            make_commit(
                "a" * 40,
                date="2024-01-01",
                files=3,
                authors=["Alice", "Bob"],
                subject="Initial commit",
            ),
            make_commit(
                "b" * 40,
                date="2024-01-02",
                files=1,
                authors=[],
                subject="Empty-authors edge case",
            ),
        ]
        cache_mod.cache_save_git_history(root, "head1", {}, {}, commits)
        result = cache_mod.cache_load_git_history(root, "head1")
        assert result is not None
        _, _, loaded = result
        self.assertEqual(loaded, commits)

    def test_miss_on_different_head(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc123", {}, {}, [])
        self.assertIsNone(cache_mod.cache_load_git_history(root, "def456"))

    def test_load_drops_non_string_entries(self) -> None:
        # Mixed string + non-string values in created/modified maps;
        # only string-keyed string-valued entries survive.
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc", {}, {}, [])
        path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(root)}.json"
        payload = {
            "version": cache_mod._GIT_HISTORY_CACHE_VERSION,
            "root": str(root),
            "commit_sha": "abc",
            "created": {
                "good.py": "2024-01-01T00:00:00Z",
                "bad.py": 12345,  # not a string
            },
            "modified": {
                "good.py": "2024-06-01T00:00:00Z",
            },
            "commits": [],
        }
        path.write_text(json.dumps(payload))
        result = cache_mod.cache_load_git_history(root, "abc")
        self.assertIsNotNone(result)
        assert result is not None  # narrow for type checker
        created, modified, commits = result
        self.assertEqual(created, {"good.py": "2024-01-01T00:00:00Z"})
        self.assertEqual(modified, {"good.py": "2024-06-01T00:00:00Z"})

    def test_git_history_cache_round_trips_commits(self):
        """Round-trip a small commits list through the cache."""
        root = Path("/some/repo")
        commits: list[CommitEntry] = [
            make_commit(
                "a" * 40, date="2024-01-01", files=3, authors=["Alice"], subject="first"
            ),
            make_commit(
                "b" * 40,
                date="2024-02-15",
                files=7,
                authors=["Bob", "Carol"],
                subject="second",
            ),
        ]
        cache_mod.cache_save_git_history(
            root,
            commit_sha="abc",
            created={"a.py": "2024-01-01"},
            modified={"a.py": "2024-02-15"},
            commits=commits,
        )
        loaded = cache_mod.cache_load_git_history(root, "abc")
        self.assertIsNotNone(loaded)
        assert loaded is not None  # narrow for type checker
        loaded_created, loaded_modified, loaded_commits = loaded
        self.assertEqual(loaded_commits, commits)

    def test_git_history_cache_drops_malformed_commits(self):
        """Per-commit validator silently drops malformed entries
        (matches _coerce_file_entry's policy for the file cache)."""
        root = Path("/some/repo")
        path = _git_history_cache_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        sha_a = "a" * 40
        sha_b = "b" * 40
        path.write_text(
            json.dumps(
                {
                    "version": cache_mod._GIT_HISTORY_CACHE_VERSION,
                    "root": str(root),
                    "commit_sha": "abc",
                    "created": {},
                    "modified": {},
                    "commits": [
                        {
                            "date": "2024-01-01",
                            "files": 3,
                            "sha": sha_a,
                            "authors": ["Alice"],
                            "subject": "ok",
                        },  # valid
                        "not a dict",  # dropped: not a dict
                        {
                            "date": 12345,
                            "files": 5,
                            "sha": sha_a,
                            "authors": [],
                            "subject": "x",
                        },  # dropped: date not str
                        {
                            "date": "2024-02-01",
                            "sha": sha_a,
                            "authors": [],
                            "subject": "x",
                        },  # dropped: missing files
                        {
                            "date": "2024-03-01",
                            "files": True,
                            "sha": sha_a,
                            "authors": [],
                            "subject": "x",
                        },  # dropped: files is bool
                        {
                            "files": 4,
                            "sha": sha_a,
                            "authors": [],
                            "subject": "x",
                        },  # dropped: missing date
                        {
                            "date": "2024-04-01",
                            "files": 7,
                            "authors": [],
                            "subject": "x",
                        },  # dropped: missing sha
                        {
                            "date": "2024-05-01",
                            "files": 2,
                            "sha": "short",
                            "authors": [],
                            "subject": "x",
                        },  # dropped: sha too short
                        {
                            "date": "2024-05-15",
                            "files": 4,
                            "sha": "Z" * 40,
                            "authors": [],
                            "subject": "x",
                        },  # dropped: non-hex sha
                        {
                            "date": "2024-07-01",
                            "files": 1,
                            "sha": sha_a,
                            "authors": "Alice",
                            "subject": "x",
                        },  # dropped: authors not a list
                        {
                            "date": "2024-08-01",
                            "files": 1,
                            "sha": sha_a,
                            "authors": ["Alice"],
                        },  # dropped: missing subject
                        {
                            "date": "2024-06-01",
                            "files": 1,
                            "sha": sha_b,
                            "authors": ["Bob"],
                            "subject": "ok2",
                        },  # valid
                    ],
                }
            ),
            encoding="utf-8",
        )
        loaded = cache_mod.cache_load_git_history(root, "abc")
        self.assertIsNotNone(loaded)
        assert loaded is not None
        _created, _modified, commits = loaded
        # Only the two well-formed entries survive (with authors + subject).
        self.assertEqual(
            commits,
            [
                make_commit(
                    sha_a, date="2024-01-01", files=3, authors=["Alice"], subject="ok"
                ),
                make_commit(
                    sha_b, date="2024-06-01", files=1, authors=["Bob"], subject="ok2"
                ),
            ],
        )

    def test_git_history_rejects_old_version(self):
        from api import cache as cache_mod
        from api.cache import (
            _git_history_cache_path,
            cache_load_git_history,
        )

        root = Path("/fake/root2")
        path = _git_history_cache_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Simulate a cache file with the previous version number.
        old = {
            "version": cache_mod._GIT_HISTORY_CACHE_VERSION - 1,
            "commit_sha": "HEADSHA",
            "created": {},
            "modified": {},
            "commits": [{"date": "2026-03-12", "files": 1}],
        }
        path.write_text(json.dumps(old))
        self.assertIsNone(cache_load_git_history(root, "HEADSHA"))

    def test_git_history_cache_v2_returns_none(self):
        """A v2 cache file (no commits field) must be treated as a miss
        so the new commits collection runs."""
        root = Path("/some/repo")
        path = _git_history_cache_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "version": 2,
                    "root": str(root),
                    "commit_sha": "abc",
                    "created": {},
                    "modified": {},
                }
            ),
            encoding="utf-8",
        )
        self.assertIsNone(cache_mod.cache_load_git_history(root, "abc"))


class ManifestCacheTests(CacheTestBase):
    def _make_manifest(self) -> Manifest:
        return make_manifest("/some/repo")

    def test_roundtrip(self) -> None:
        root = Path("/some/repo")
        sig = "deadbeef" * 4
        manifest = self._make_manifest()
        cache_mod.cache_save_manifest(root, sig, manifest)
        self.assertEqual(cache_mod.cache_load_manifest(root, sig), manifest)

    def test_load_wrong_signature_returns_none(self) -> None:
        cache_mod.cache_save_manifest(
            Path("/x"),
            "a" * 32,
            self._make_manifest(),
        )
        self.assertIsNone(cache_mod.cache_load_manifest(Path("/x"), "b" * 32))

    def test_manifest_rejects_when_git_history_version_changed(self):
        """A manifest cache file written under a prior _GIT_HISTORY_CACHE_VERSION
        must be dropped on load, because the composite version string changes
        when git-history bumps."""
        from api.cache import (
            _manifest_cache_path,
            cache_load_manifest,
        )
        import gzip

        # Write a manifest stamped with a version string that mimics the
        # OLD git-history version (current minus one).
        old_g = cache_mod._GIT_HISTORY_CACHE_VERSION - 1
        stale_version = f"m{cache_mod._MANIFEST_SCHEMA_VERSION}-g{old_g}"
        root = Path("/fake/root")
        sig = "deadbeef" * 8
        path = _manifest_cache_path(root, sig)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Manifest cache files are gzipped JSON.
        payload = json.dumps(
            {
                "version": stale_version,
                "manifest": {
                    "root": str(root),
                    "scanned_at": "x",
                    "content_signature": sig,
                    "structure_signature": sig,
                    "tree": {},
                    "repo": None,
                    "commits": None,
                },
            }
        )
        with gzip.open(path, "wb") as fh:
            fh.write(payload.encode("utf-8"))
        # Loader must reject.
        self.assertIsNone(cache_load_manifest(root, sig))

    def test_ref_manifest_roundtrip(self) -> None:
        root = Path("/some/repo")
        sha = "a" * 40
        manifest = self._make_manifest()
        cache_mod.cache_save_ref_manifest(root, sha, manifest)
        self.assertEqual(cache_mod.cache_load_ref_manifest(root, sha), manifest)

    def test_ref_manifest_load_missing_returns_none(self) -> None:
        self.assertIsNone(
            cache_mod.cache_load_ref_manifest(Path("/never/scanned"), "b" * 40)
        )

    def _make_bundle(self) -> TimelineBundle:
        return make_timeline_bundle(unionManifest=self._make_manifest())

    def test_timeline_roundtrip(self) -> None:
        root = Path("/some/repo")
        sha = "a" * 40
        bundle = self._make_bundle()
        cache_mod.cache_save_timeline(root, sha, bundle)
        self.assertEqual(cache_mod.cache_load_timeline(root, sha), bundle)

    def test_timeline_excludes_key_separately(self) -> None:
        # Excludes reshape the filtered union, so they're part of the cache key:
        # a bundle saved with one exclude set must not be served for another,
        # and the empty-set key stays independent of both.
        root = Path("/some/repo")
        sha = "a" * 40
        base, filtered = self._make_bundle(), self._make_bundle()
        filtered.note = "filtered"  # make the two bundles distinguishable
        cache_mod.cache_save_timeline(root, sha, base)
        cache_mod.cache_save_timeline(root, sha, filtered, frozenset({"secrets"}))

        self.assertEqual(cache_mod.cache_load_timeline(root, sha), base)
        self.assertEqual(
            cache_mod.cache_load_timeline(root, sha, frozenset({"secrets"})), filtered
        )
        # A different exclude set is a miss, not a wrong-bundle hit.
        self.assertIsNone(
            cache_mod.cache_load_timeline(root, sha, frozenset({"other"}))
        )

    def test_clear_timeline_evicts_all_heads_only(self) -> None:
        # A no_cache scan clears every timeline bundle for the root (all HEADs)
        # but leaves the manifest caches untouched.
        root = Path("/x")
        cache_mod.cache_save_manifest(root, "a" * 32, self._make_manifest())
        cache_mod.cache_save_timeline(root, "b" * 40, self._make_bundle())
        cache_mod.cache_save_timeline(root, "c" * 40, self._make_bundle())

        deleted = cache_mod.cache_clear_timeline(root)
        self.assertEqual(deleted, 2)
        self.assertIsNone(cache_mod.cache_load_timeline(root, "b" * 40))
        self.assertIsNone(cache_mod.cache_load_timeline(root, "c" * 40))
        self.assertIsNotNone(cache_mod.cache_load_manifest(root, "a" * 32))

    def test_clear_timeline_missing_dir_returns_zero(self) -> None:
        self.assertFalse((cache_mod.CACHE_ROOT / "manifests").exists())
        self.assertEqual(cache_mod.cache_clear_timeline(Path("/never")), 0)


class MediaDimsCacheTests(CacheTestBase):
    def setUp(self) -> None:
        super().setUp()
        self.abs_root = self.cache_root / "fake-repo"

    def test_media_dims_round_trip(self) -> None:
        entry: cache_mod.FileEntry = {
            "size": 100,
            "mtime": 1.5,
            "lines": 0,
            "binary": True,
            "ext": ".png",
            "media_width": 320,
            "media_height": 240,
        }
        cache_mod.cache_save_files(self.abs_root, {"img.png": entry})
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertIn("img.png", loaded)
        self.assertEqual(loaded["img.png"]["media_width"], 320)
        self.assertEqual(loaded["img.png"]["media_height"], 240)

    def test_entry_without_media_dims_loads_cleanly(self) -> None:
        entry: cache_mod.FileEntry = {
            "size": 100,
            "mtime": 1.5,
            "lines": 50,
            "binary": False,
            "ext": ".py",
        }
        cache_mod.cache_save_files(self.abs_root, {"code.py": entry})
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertIn("code.py", loaded)
        self.assertNotIn("media_width", loaded["code.py"])
        self.assertNotIn("media_height", loaded["code.py"])

    def test_partial_media_dims_drops_both(self) -> None:
        # Manually write a cache file with only media_width (no height);
        # the coercer must drop both rather than carry a half-populated entry.
        cache_path = cache_mod._file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "version": cache_mod._FILE_CACHE_VERSION,
                    "entries": {
                        "weird.png": {
                            "size": 10,
                            "mtime": 1.0,
                            "lines": 0,
                            "binary": True,
                            "ext": ".png",
                            "media_width": 100,
                            # media_height intentionally missing
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertNotIn("media_width", loaded["weird.png"])
        self.assertNotIn("media_height", loaded["weird.png"])

    def test_bool_media_dims_are_rejected(self) -> None:
        """bool is a subclass of int but must not coerce into media dims."""
        cache_path = cache_mod._file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "version": cache_mod._FILE_CACHE_VERSION,
                    "entries": {
                        "fake.png": {
                            "size": 10,
                            "mtime": 1.0,
                            "lines": 0,
                            "binary": True,
                            "ext": ".png",
                            "media_width": True,
                            "media_height": False,
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertNotIn("media_width", loaded["fake.png"])
        self.assertNotIn("media_height", loaded["fake.png"])

    def test_partial_media_dims_height_only_drops_both(self) -> None:
        cache_path = cache_mod._file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "version": cache_mod._FILE_CACHE_VERSION,
                    "entries": {
                        "weird.png": {
                            "size": 10,
                            "mtime": 1.0,
                            "lines": 0,
                            "binary": True,
                            "ext": ".png",
                            "media_height": 200,
                            # media_width intentionally missing
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertNotIn("media_width", loaded["weird.png"])
        self.assertNotIn("media_height", loaded["weird.png"])


def test_blob_stats_cache_roundtrip(tmp_path, monkeypatch):
    from api import cache

    monkeypatch.setattr(cache, "CACHE_ROOT", tmp_path)
    root = tmp_path / "repo"
    entries = {
        "a" * 40: {"lines": 12, "binary": False},
        "b" * 40: {"lines": 0, "binary": True, "media_width": 4, "media_height": 8},
    }
    cache.cache_save_blobs(root, entries)
    loaded = cache.cache_load_blobs(root)
    assert loaded["a" * 40] == {"lines": 12, "binary": False}
    assert loaded["b" * 40]["media_width"] == 4
    assert loaded["b" * 40]["media_height"] == 8


def test_blob_stats_cache_version_mismatch_is_miss(tmp_path, monkeypatch):
    from api import cache

    monkeypatch.setattr(cache, "CACHE_ROOT", tmp_path)
    root = tmp_path / "repo"
    p = cache._blob_cache_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text('{"version": -1, "entries": {"x": 1}}')
    assert cache.cache_load_blobs(root) == {}


if __name__ == "__main__":
    unittest.main()


class ManifestCachePruneTests(CacheTestBase):
    """Retention on the manifests/ dir.

    Every entry there is keyed by repo CONTENT, so the directory grew for the
    life of the install — 844 files / 281 MB on one dev machine before this.
    """

    def _manifest(self) -> Manifest:
        return make_manifest("/some/repo")

    def _names(self, root: Path) -> list[str]:
        prefix = f"{cache_mod.repo_key(root)}__"
        d = cache_mod.CACHE_ROOT / "manifests"
        return sorted(p.name[len(prefix) :] for p in d.glob(f"{prefix}*.json.gz"))

    def test_content_signatures_are_capped(self) -> None:
        root = Path("/x")
        keep = cache_mod._KEEP_CONTENT_MANIFESTS
        for i in range(keep + 4):
            cache_mod.cache_save_manifest(root, f"{i:032x}", self._manifest())

        self.assertEqual(len(self._names(root)), keep)

    def test_the_entry_just_written_always_survives(self) -> None:
        # Pruning runs after the save, so the newest write is never the victim.
        root = Path("/x")
        for i in range(cache_mod._KEEP_CONTENT_MANIFESTS + 3):
            sig = f"{i:032x}"
            cache_mod.cache_save_manifest(root, sig, self._manifest())
            self.assertIsNotNone(cache_mod.cache_load_manifest(root, sig))

    def test_families_are_capped_independently(self) -> None:
        # A scrub session writing many ref manifests must not evict the live
        # content-signature manifest out from under the running scan.
        root = Path("/x")
        cache_mod.cache_save_manifest(root, "a" * 32, self._manifest())
        for i in range(cache_mod._KEEP_REF_MANIFESTS + 5):
            cache_mod.cache_save_ref_manifest(root, f"{i:040x}", self._manifest())

        self.assertIsNotNone(cache_mod.cache_load_manifest(root, "a" * 32))
        refs = [n for n in self._names(root) if n.startswith("ref-")]
        self.assertEqual(len(refs), cache_mod._KEEP_REF_MANIFESTS)

    def test_pruning_one_repo_leaves_another_alone(self) -> None:
        other = Path("/y")
        cache_mod.cache_save_manifest(other, "c" * 32, self._manifest())
        for i in range(cache_mod._KEEP_CONTENT_MANIFESTS + 3):
            cache_mod.cache_save_manifest(Path("/x"), f"{i:032x}", self._manifest())

        self.assertIsNotNone(cache_mod.cache_load_manifest(other, "c" * 32))

    def test_prune_on_a_never_scanned_root_is_a_noop(self) -> None:
        self.assertEqual(cache_mod.prune_manifest_cache(Path("/never/scanned")), 0)

    def test_prune_with_no_manifests_dir_is_a_noop(self) -> None:
        self.assertFalse((cache_mod.CACHE_ROOT / "manifests").exists())
        self.assertEqual(cache_mod.prune_manifest_cache(Path("/x")), 0)

    def test_protect_survives_even_when_it_ranks_oldest(self) -> None:
        # mtime can tie (one-second resolution), ranking the just-written entry
        # anywhere. Pinned to the worst case, it must still survive.
        root = Path("/x")
        d = cache_mod.CACHE_ROOT / "manifests"
        d.mkdir(parents=True, exist_ok=True)

        # Write past the cap directly, so setup does not prune as it goes.
        paths = []
        for i in range(cache_mod._KEEP_CONTENT_MANIFESTS + 3):
            path = cache_mod._manifest_cache_path(root, f"{i:032x}")
            cache_mod._save_gz_manifest(path, self._manifest())
            paths.append(path)

        victim = paths[0]
        os.utime(victim, (1, 1))  # oldest by a wide margin -> first to go

        cache_mod.prune_manifest_cache(root, protect=victim)

        self.assertTrue(victim.exists(), "protected entry was evicted")
        remaining = list(d.glob(f"{cache_mod.repo_key(root)}__*.json.gz"))
        self.assertEqual(len(remaining), cache_mod._KEEP_CONTENT_MANIFESTS)
