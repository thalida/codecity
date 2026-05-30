"""Unit tests for api/cache.py."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import pytest

from api import cache as cache_mod
from api.cache import _git_history_cache_path
from api.types import CommitEntry


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
                "size": 1234, "mtime": 1715000000.0,
                "lines": 42, "binary": False, "ext": ".py",
            },
        }
        cache_mod.cache_save_files(root, entries)
        self.assertEqual(cache_mod.cache_load_files(root), entries)

    def test_load_missing_returns_empty(self) -> None:
        self.assertEqual(cache_mod.cache_load_files(Path("/never/scanned")), {})

    def test_load_corrupted_returns_empty(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_files(root, {})  # ensure dir exists
        path = cache_mod.CACHE_ROOT / "files" / f"{cache_mod.repo_key(root)}.json"
        path.write_text("{not valid json")
        self.assertEqual(cache_mod.cache_load_files(root), {})

    def test_load_version_mismatch_returns_empty(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_files(root, {})
        path = cache_mod.CACHE_ROOT / "files" / f"{cache_mod.repo_key(root)}.json"
        bad = {"version": 999, "root": str(root), "entries": {"a": "b"}}
        path.write_text(json.dumps(bad))
        self.assertEqual(cache_mod.cache_load_files(root), {})

    def test_atomic_write_no_temp_left_behind(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_files(root, {"a": {"size": 0, "mtime": 0.0,
                                                "lines": 0, "binary": False, "ext": ""}})
        files_dir = cache_mod.CACHE_ROOT / "files"
        leftovers = [p for p in files_dir.iterdir() if p.suffix == ".tmp"]
        self.assertEqual(leftovers, [])

    def test_load_drops_malformed_entries(self) -> None:
        # Mix valid and invalid entries; valid ones survive, invalid ones drop.
        root = Path("/some/repo")
        cache_mod.cache_save_files(root, {})
        path = cache_mod.CACHE_ROOT / "files" / f"{cache_mod.repo_key(root)}.json"
        payload = {
            "version": 1,
            "root": str(root),
            "entries": {
                "good.py": {"size": 1, "mtime": 1.0, "lines": 1,
                            "binary": False, "ext": ".py"},
                "missing-fields.py": {"size": 1},   # incomplete
                "wrong-type.py": {"size": "not-an-int", "mtime": 1.0,
                                  "lines": 1, "binary": False, "ext": ".py"},
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

    def test_miss_on_different_head(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc123", {}, {}, [])
        self.assertIsNone(
            cache_mod.cache_load_git_history(root, "def456")
        )

    def test_load_missing_returns_none(self) -> None:
        self.assertIsNone(
            cache_mod.cache_load_git_history(Path("/never/scanned"), "abc123")
        )

    def test_load_corrupted_returns_none(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc", {}, {}, [])
        path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(root)}.json"
        path.write_text("{garbage")
        self.assertIsNone(cache_mod.cache_load_git_history(root, "abc"))

    def test_load_version_mismatch_returns_none(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc", {}, {}, [])
        path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(root)}.json"
        bad = {"version": 999, "root": str(root), "head_sha": "abc",
               "created": {}, "modified": {}}
        path.write_text(json.dumps(bad))
        self.assertIsNone(cache_mod.cache_load_git_history(root, "abc"))

    def test_load_drops_non_string_entries(self) -> None:
        # Mixed string + non-string values in created/modified maps;
        # only string-keyed string-valued entries survive.
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc", {}, {}, [])
        path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(root)}.json"
        payload = {
            "version": cache_mod._GIT_HISTORY_CACHE_VERSION,
            "root": str(root), "head_sha": "abc",
            "created": {
                "good.py": "2024-01-01T00:00:00Z",
                "bad.py": 12345,   # not a string
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
            {"date": "2024-01-01", "files": 3, "sha": "a" * 40},
            {"date": "2024-02-15", "files": 7, "sha": "b" * 40},
        ]
        cache_mod.cache_save_git_history(
            root, head_sha="abc",
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
        path.write_text(json.dumps({
            "version": cache_mod._GIT_HISTORY_CACHE_VERSION,
            "root": str(root),
            "head_sha": "abc",
            "created": {},
            "modified": {},
            "commits": [
                {"date": "2024-01-01", "files": 3, "sha": sha_a},   # valid
                "not a dict",                                         # dropped: not a dict
                {"date": 12345, "files": 5, "sha": sha_a},           # dropped: date not str
                {"date": "2024-02-01", "sha": sha_a},                # dropped: missing files
                {"date": "2024-03-01", "files": True, "sha": sha_a}, # dropped: files is bool
                {"files": 4, "sha": sha_a},                          # dropped: missing date
                {"date": "2024-04-01", "files": 7},                  # dropped: missing sha
                {"date": "2024-05-01", "files": 2, "sha": "short"},  # dropped: sha too short
                {"date": "2024-05-15", "files": 4, "sha": "Z" * 40}, # sha contains non-hex characters
                {"date": "2024-06-01", "files": 1, "sha": sha_b},    # valid
            ],
        }), encoding="utf-8")
        loaded = cache_mod.cache_load_git_history(root, "abc")
        self.assertIsNotNone(loaded)
        assert loaded is not None
        _created, _modified, commits = loaded
        # Only the two well-formed entries survive.
        self.assertEqual(commits, [
            {"date": "2024-01-01", "files": 3, "sha": sha_a},
            {"date": "2024-06-01", "files": 1, "sha": sha_b},
        ])

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
            "head_sha": "HEADSHA",
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
        path.write_text(json.dumps({
            "version": 2,
            "root": str(root),
            "head_sha": "abc",
            "created": {},
            "modified": {},
        }), encoding="utf-8")
        self.assertIsNone(cache_mod.cache_load_git_history(root, "abc"))


class ManifestCacheTests(CacheTestBase):
    def _make_manifest(self) -> dict:
        return {
            "root": "/some/repo",
            "scanned_at": "2026-05-17T00:00:00Z",
            "signature": "deadbeef" * 4,
            "tree": {
                "name": "repo", "type": "dir", "path": "", "fullPath": "/some/repo",
                "children": [],
            },
            "repo": None,
        }

    def test_roundtrip(self) -> None:
        root = Path("/some/repo")
        sig = "deadbeef" * 4
        manifest = self._make_manifest()
        cache_mod.cache_save_manifest(root, sig, manifest)
        self.assertEqual(cache_mod.cache_load_manifest(root, sig), manifest)

    def test_load_missing_returns_none(self) -> None:
        self.assertIsNone(
            cache_mod.cache_load_manifest(Path("/never/scanned"), "x" * 32)
        )

    def test_load_wrong_signature_returns_none(self) -> None:
        cache_mod.cache_save_manifest(
            Path("/x"), "a" * 32, self._make_manifest(),
        )
        self.assertIsNone(cache_mod.cache_load_manifest(Path("/x"), "b" * 32))

    def test_load_corrupt_gzip_returns_none(self) -> None:
        # Write a file at the cache path that is NOT valid gzip.
        path = cache_mod._manifest_cache_path(Path("/x"), "a" * 32)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"not gzipped, definitely not JSON")
        self.assertIsNone(cache_mod.cache_load_manifest(Path("/x"), "a" * 32))

    def test_load_version_mismatch_returns_none(self) -> None:
        path = cache_mod._manifest_cache_path(Path("/x"), "a" * 32)
        path.parent.mkdir(parents=True, exist_ok=True)
        import gzip
        with gzip.open(path, "wb") as fh:
            fh.write(json.dumps({"version": 999, "manifest": {}}).encode("utf-8"))
        self.assertIsNone(cache_mod.cache_load_manifest(Path("/x"), "a" * 32))

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
        payload = json.dumps({
            "version": stale_version,
            "manifest": {"root": str(root), "scanned_at": "x", "signature": sig, "tree_signature": sig, "tree": {}, "repo": None, "commits": None},
        })
        with gzip.open(path, "wb") as fh:
            fh.write(payload.encode("utf-8"))
        # Loader must reject.
        self.assertIsNone(cache_load_manifest(root, sig))

    def test_clear_manifests_deletes_every_signature(self) -> None:
        root = Path("/x")
        manifest = self._make_manifest()
        cache_mod.cache_save_manifest(root, "a" * 32, manifest)
        cache_mod.cache_save_manifest(root, "b" * 32, manifest)
        # Unrelated root — must NOT be deleted.
        cache_mod.cache_save_manifest(Path("/y"), "c" * 32, manifest)

        deleted = cache_mod.cache_clear_manifests(root)
        self.assertEqual(deleted, 2)
        self.assertIsNone(cache_mod.cache_load_manifest(root, "a" * 32))
        self.assertIsNone(cache_mod.cache_load_manifest(root, "b" * 32))
        # Unrelated root's cache survives.
        self.assertIsNotNone(cache_mod.cache_load_manifest(Path("/y"), "c" * 32))

    def test_clear_manifests_no_entries_returns_zero(self) -> None:
        self.assertEqual(cache_mod.cache_clear_manifests(Path("/never/scanned")), 0)

    def test_clear_manifests_missing_dir_returns_zero(self) -> None:
        # CACHE_ROOT/manifests doesn't exist yet (no saves have happened).
        self.assertFalse((cache_mod.CACHE_ROOT / "manifests").exists())
        self.assertEqual(cache_mod.cache_clear_manifests(Path("/x")), 0)


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
        cache_path.write_text(json.dumps({
            "version": 1,
            "entries": {
                "weird.png": {
                    "size": 10, "mtime": 1.0, "lines": 0,
                    "binary": True, "ext": ".png", "media_width": 100,
                    # media_height intentionally missing
                },
            },
        }), encoding="utf-8")
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertNotIn("media_width", loaded["weird.png"])
        self.assertNotIn("media_height", loaded["weird.png"])

    def test_bool_media_dims_are_rejected(self) -> None:
        """bool is a subclass of int but must not coerce into media dims."""
        cache_path = cache_mod._file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            "version": 1,
            "entries": {
                "fake.png": {
                    "size": 10, "mtime": 1.0, "lines": 0,
                    "binary": True, "ext": ".png",
                    "media_width": True, "media_height": False,
                },
            },
        }), encoding="utf-8")
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertNotIn("media_width", loaded["fake.png"])
        self.assertNotIn("media_height", loaded["fake.png"])

    def test_partial_media_dims_height_only_drops_both(self) -> None:
        cache_path = cache_mod._file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            "version": 1,
            "entries": {
                "weird.png": {
                    "size": 10, "mtime": 1.0, "lines": 0,
                    "binary": True, "ext": ".png",
                    "media_height": 200,
                    # media_width intentionally missing
                },
            },
        }), encoding="utf-8")
        loaded = cache_mod.cache_load_files(self.abs_root)
        self.assertNotIn("media_width", loaded["weird.png"])
        self.assertNotIn("media_height", loaded["weird.png"])


if __name__ == "__main__":
    unittest.main()
