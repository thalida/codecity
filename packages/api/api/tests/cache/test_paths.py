"""Cache file naming: the repo key every entry hangs off."""

from __future__ import annotations

from pathlib import Path


from api.cache.storage import paths as cache_paths
from api.tests.cache._helpers import CacheTestBase


class RepoKeyTests(CacheTestBase):
    def test_stable(self) -> None:
        self.assertEqual(
            cache_paths.repo_key(Path("/foo/bar")),
            cache_paths.repo_key(Path("/foo/bar")),
        )

    def test_distinct(self) -> None:
        self.assertNotEqual(
            cache_paths.repo_key(Path("/foo/bar")),
            cache_paths.repo_key(Path("/foo/baz")),
        )

    def test_short_hex(self) -> None:
        # 16 hex chars — long enough to be unique, short enough to be readable.
        k = cache_paths.repo_key(Path("/foo/bar"))
        self.assertEqual(len(k), 16)
        int(k, 16)  # raises if not hex
