"""Tests for the api CLI entrypoint (api.__main__)."""

from __future__ import annotations

import subprocess
import sys


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "api", *args],
        capture_output=True,
        text=True,
        timeout=5,
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


def test_main_invokes_uvicorn() -> None:
    from unittest import mock
    from api.__main__ import main

    with mock.patch("api.__main__.uvicorn.run") as run:
        assert main(["--port", "9999"]) == 0
        run.assert_called_once()
        assert run.call_args.kwargs["port"] == 9999
        assert run.call_args.kwargs["workers"] == 1


def test_binds_loopback_by_default() -> None:
    """The API is unauthenticated and serves any registered scan root, so the
    default bind must not reach the network. Containers opt in explicitly."""
    from unittest import mock
    from api.__main__ import main

    with mock.patch("api.__main__.uvicorn.run") as run:
        assert main([]) == 0
        assert run.call_args.kwargs["host"] == "127.0.0.1"


def test_host_flag_can_opt_into_exposure() -> None:
    from unittest import mock
    from api.__main__ import main

    with mock.patch("api.__main__.uvicorn.run") as run:
        assert main(["--host", "0.0.0.0"]) == 0
        assert run.call_args.kwargs["host"] == "0.0.0.0"
