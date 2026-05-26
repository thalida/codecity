"""Tests for api._reload (dev auto-reload helper)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def test_reload_module_imports():
    """Smoke test — the module exists and is importable."""
    spec = importlib.util.find_spec("api._reload")
    assert spec is not None


def test_run_with_reload_callable():
    """run_with_reload is the public entrypoint used by api.__main__."""
    from api._reload import run_with_reload

    assert callable(run_with_reload)


def test_changed_paths_filter(monkeypatch: pytest.MonkeyPatch):
    """The filter returns True only for .py files under the watched root."""
    from api import _reload

    # Pin WATCH_ROOT to a stable fake path so the assertions read cleanly
    # and don't depend on where the repo lives on disk.
    monkeypatch.setattr(_reload, "WATCH_ROOT", Path("/srv/api"))

    assert _reload._is_python_source(Path("/srv/api/scan.py")) is True
    assert _reload._is_python_source(Path("/srv/api/sub/foo.py")) is True
    assert _reload._is_python_source(Path("/srv/api/foo.txt")) is False
    assert _reload._is_python_source(Path("/srv/api/__pycache__/foo.cpython.pyc")) is False
