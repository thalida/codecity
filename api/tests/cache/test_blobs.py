"""The content-addressed blob-stats cache, keyed by sha."""

from __future__ import annotations

from api import cache as cache_mod
from api.cache.storage import paths as cache_paths


def test_blob_stats_cache_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_paths, "CACHE_ROOT", tmp_path)
    root = tmp_path / "repo"
    entries = {
        "a" * 40: {"lines": 12, "binary": False},
        "b" * 40: {"lines": 0, "binary": True, "media_width": 4, "media_height": 8},
    }
    cache_mod.cache_save_blobs(root, entries)
    loaded = cache_mod.cache_load_blobs(root)
    assert loaded["a" * 40] == {"lines": 12, "binary": False}
    assert loaded["b" * 40]["media_width"] == 4
    assert loaded["b" * 40]["media_height"] == 8


def test_blob_stats_cache_version_mismatch_is_miss(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_paths, "CACHE_ROOT", tmp_path)
    root = tmp_path / "repo"
    p = cache_paths.blob_cache_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text('{"version": -1, "entries": {"x": 1}}')
    assert cache_mod.cache_load_blobs(root) == {}
