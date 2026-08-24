"""The per-path file-stat cache, keyed by (size, mtime)."""

from __future__ import annotations

import json
from pathlib import Path


from api import cache as cache_mod
from api.cache.content import files as cache_files
from api.cache.storage import paths as cache_paths
from api.cache.content.entries import FileEntry
from api.tests.cache._helpers import CacheTestBase


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
        files_dir = cache_paths.CACHE_ROOT / "files"
        leftovers = [p for p in files_dir.iterdir() if p.suffix == ".tmp"]
        self.assertEqual(leftovers, [])

    def test_load_drops_malformed_entries(self) -> None:
        # Mix valid and invalid entries; valid ones survive, invalid ones drop.
        root = Path("/some/repo")
        cache_mod.cache_save_files(root, {})
        path = cache_paths.CACHE_ROOT / "files" / f"{cache_paths.repo_key(root)}.json"
        payload = {
            "version": cache_files.VERSION,
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


class MediaDimsCacheTests(CacheTestBase):
    def setUp(self) -> None:
        super().setUp()
        self.abs_root = self.cache_root / "fake-repo"

    def test_media_dims_round_trip(self) -> None:
        entry: FileEntry = {
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
        entry: FileEntry = {
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
        cache_path = cache_paths.file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "version": cache_files.VERSION,
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
        cache_path = cache_paths.file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "version": cache_files.VERSION,
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
        cache_path = cache_paths.file_cache_path(self.abs_root)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "version": cache_files.VERSION,
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
