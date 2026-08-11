"""Scanner control-flow exceptions.

A leaf module so clone.py can raise ScanCancelledError without importing
api.scan, which imports api.git.clone back through api.git.source."""

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
