"""Scanner progress reporting, shared by the scan and timeline walks."""

from __future__ import annotations

import sys
import time
from typing import Callable

from api.core.config import quiet

# Long enough to coalesce tick(), which fires once per file — thousands/sec on
# a warm fs cache.
SCAN_PROGRESS_THROTTLE_S = 0.25


def log(msg: str) -> None:
    if not quiet():
        print(f"[scan] {msg}", file=sys.stderr, flush=True)


class Heartbeat:
    """Per-scan file counter. Per-scan and not global because concurrent
    /api/manifest requests would otherwise share and garble one tally.

    ``on_progress`` becomes one server-side `scanning` event, throttled."""

    __slots__ = ("seen", "_on_progress", "_last_emit", "_last_emitted_count")

    def __init__(self, on_progress: Callable[[int], None] | None = None) -> None:
        self.seen = 0
        self._on_progress = on_progress
        self._last_emit = 0.0
        self._last_emitted_count = -1

    def tick(self) -> None:
        self.seen += 1
        if self.seen % 100 == 0:
            log(f"  walked {self.seen} files so far…")
        if self._on_progress is None:
            return
        now = time.monotonic()
        if now - self._last_emit < SCAN_PROGRESS_THROTTLE_S:
            return
        self._on_progress(self.seen)
        self._last_emit = now
        self._last_emitted_count = self.seen

    def flush(self) -> None:
        """Emit the true final count, which the throttle may have swallowed."""
        if self._on_progress is None:
            return
        if self.seen != self._last_emitted_count:
            self._on_progress(self.seen)
            self._last_emitted_count = self.seen
