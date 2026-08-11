"""Scanner control-flow exceptions.

A leaf module so clone.py can raise ScanCancelledError without importing
scan.py, which imports clone.py back through source.py."""

from __future__ import annotations

import threading


class ScanCancelledError(Exception):
    """The server's disconnect watchdog sets the cancel event; the scanner
    polls it at phase boundaries. Caught server-side so a cancelled scan isn't
    surfaced as a 5xx."""


class NotAGitRepoError(ValueError):
    """Root isn't a git working tree. The server enforces git-only at the HTTP
    boundary; this is defense-in-depth for direct callers."""


def check_cancel(event: threading.Event | None) -> None:
    if event is not None and event.is_set():
        raise ScanCancelledError()
