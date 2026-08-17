"""Shared fixtures for the api/cache tests: one redirected CACHE_ROOT,
and the constants every cache's tests key against."""

from __future__ import annotations

import unittest
from pathlib import Path

import pytest

from api.tests.conftest import make_manifest


_ROOT = Path("/some/repo")
_SIG = "a" * 32
_SHA = "a" * 40


def _stub_manifest():
    return make_manifest(str(_ROOT))


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
