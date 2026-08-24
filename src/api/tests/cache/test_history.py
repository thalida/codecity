"""The per-repo git-history cache, keyed by the commit it walked from."""

from __future__ import annotations

import json
from pathlib import Path


from api import cache as cache_mod
from api.cache.results import history as cache_history
from api.cache.storage import paths as cache_paths
from api.cache.storage.paths import git_history_cache_path as _git_history_cache_path
from api.models.manifest import CommitEntry
from api.tests.conftest import make_commit
from api.tests.cache._helpers import CacheTestBase


class GitHistoryCacheTests(CacheTestBase):
    def test_hit_on_matching_head(self) -> None:
        root = Path("/some/repo")
        created = {"src/a.py": "2024-01-01T00:00:00Z"}
        modified = {"src/a.py": "2024-06-01T00:00:00Z"}
        cache_mod.cache_save_git_history(root, "abc123", created, modified, [])
        result = cache_mod.cache_load_git_history(root, "abc123")
        self.assertEqual(result, (created, modified, []))

    def test_round_trips_full_commit_entries(self) -> None:
        # The WHOLE entry, authors included: dropping them once meant a warm
        # cache crashed the fireflies consumer that iterates them.
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
        path = (
            cache_paths.CACHE_ROOT
            / "git-history"
            / f"{cache_paths.repo_key(root)}.json"
        )
        payload = {
            "version": cache_history.VERSION,
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
                    "version": cache_history.VERSION,
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
        from api.cache import cache_load_git_history
        from api.cache.storage.paths import (
            git_history_cache_path as _git_history_cache_path,
        )

        root = Path("/fake/root2")
        path = _git_history_cache_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Simulate a cache file with the previous version number.
        old = {
            "version": cache_history.VERSION - 1,
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
