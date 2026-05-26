"""Tests for the api CLI entrypoint (api.__main__)."""

from __future__ import annotations

import subprocess
import sys


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "api", *args],
        capture_output=True, text=True, timeout=5,
    )


def test_version_flag_prints_version():
    res = _run_cli("--version")
    assert res.returncode == 0
    assert "codecity" in res.stdout.lower()


def test_help_flag_prints_help():
    res = _run_cli("--help")
    assert res.returncode == 0
    assert "--port" in res.stdout
    assert "--reload" in res.stdout


def test_invalid_arg_exits_nonzero():
    res = _run_cli("--no-such-flag")
    assert res.returncode != 0
