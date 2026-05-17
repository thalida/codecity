"""Unit tests for codecity/cache.py."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codecity import cache as cache_mod


class CacheTestBase(unittest.TestCase):
    """Redirect CACHE_ROOT to a tempdir so tests don't touch ~/.cache."""

    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._original_root = cache_mod.CACHE_ROOT
        cache_mod.CACHE_ROOT = Path(self._tmp.name)
        self.addCleanup(self._restore_root)

    def _restore_root(self) -> None:
        cache_mod.CACHE_ROOT = self._original_root


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
        cache_mod.cache_save_git_history(root, "abc123", created, modified)
        result = cache_mod.cache_load_git_history(root, "abc123")
        self.assertEqual(result, (created, modified))

    def test_miss_on_different_head(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc123", {}, {})
        self.assertIsNone(cache_mod.cache_load_git_history(root, "def456"))

    def test_load_missing_returns_none(self) -> None:
        self.assertIsNone(
            cache_mod.cache_load_git_history(Path("/never/scanned"), "abc123")
        )

    def test_load_corrupted_returns_none(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc", {}, {})
        path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(root)}.json"
        path.write_text("{garbage")
        self.assertIsNone(cache_mod.cache_load_git_history(root, "abc"))

    def test_load_version_mismatch_returns_none(self) -> None:
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc", {}, {})
        path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(root)}.json"
        bad = {"version": 999, "root": str(root), "head_sha": "abc",
               "created": {}, "modified": {}}
        path.write_text(json.dumps(bad))
        self.assertIsNone(cache_mod.cache_load_git_history(root, "abc"))

    def test_load_drops_non_string_entries(self) -> None:
        # Mixed string + non-string values in created/modified maps;
        # only string-keyed string-valued entries survive.
        root = Path("/some/repo")
        cache_mod.cache_save_git_history(root, "abc", {}, {})
        path = cache_mod.CACHE_ROOT / "git-history" / f"{cache_mod.repo_key(root)}.json"
        payload = {
            "version": 1, "root": str(root), "head_sha": "abc",
            "created": {
                "good.py": "2024-01-01T00:00:00Z",
                "bad.py": 12345,   # not a string
            },
            "modified": {
                "good.py": "2024-06-01T00:00:00Z",
            },
        }
        path.write_text(json.dumps(payload))
        result = cache_mod.cache_load_git_history(root, "abc")
        self.assertIsNotNone(result)
        created, modified = result
        self.assertEqual(created, {"good.py": "2024-01-01T00:00:00Z"})
        self.assertEqual(modified, {"good.py": "2024-06-01T00:00:00Z"})


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


if __name__ == "__main__":
    unittest.main()
