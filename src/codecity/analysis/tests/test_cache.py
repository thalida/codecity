# src/codecity/analysis/tests/test_cache.py
import tempfile
from pathlib import Path

from codecity.analysis.cache import AnalysisCache


def test_cache_save_and_load() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")

        data = {"test": "value", "number": 42}
        cache.save("analysis", data)

        loaded = cache.load("analysis")
        assert loaded == data


def test_cache_returns_none_for_missing() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")
        assert cache.load("nonexistent") is None


def test_cache_uses_repo_hash_subdir() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")
        cache.save("test", {"key": "value"})

        # Should create a subdirectory based on repo path hash
        subdirs = list(Path(tmpdir).iterdir())
        assert len(subdirs) == 1
        assert subdirs[0].is_dir()


def test_cache_invalidate() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")

        cache.save("test", {"key": "value"})
        assert cache.load("test") is not None

        cache.invalidate("test")
        assert cache.load("test") is None


def test_cache_invalidate_all() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")

        cache.save("test1", {"key": "value1"})
        cache.save("test2", {"key": "value2"})
        assert cache.load("test1") is not None
        assert cache.load("test2") is not None

        cache.invalidate_all()
        assert cache.load("test1") is None
        assert cache.load("test2") is None


def test_cache_load_returns_none_for_corrupt_json() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")

        # Write corrupt JSON directly to the cache file
        cache_file = cache._cache_file("corrupt")
        cache_file.write_text("{ invalid json content")

        assert cache.load("corrupt") is None
