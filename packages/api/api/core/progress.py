"""Telling the user what a long-running job is doing.

Two shapes, both shared by the scan, timeline and clone paths:

  - ``log`` — a line on stderr, silenced by CODECITY_QUIET.
  - ``Throttle`` — the "emit at most every N seconds, but never swallow the
    final value" rule. Getting that second half wrong leaves a progress bar
    parked at 97% forever, so it is written once here rather than at each of
    the three call sites that need it.
"""

from __future__ import annotations

import sys
import time
from typing import Callable, Generic, TypeVar

from api.core.config import quiet

# Long enough to coalesce a per-file tick (thousands/sec on a warm fs cache),
# short enough to still read as live. git's clone output arrives at a like rate.
PROGRESS_THROTTLE_S = 0.25

T = TypeVar("T")


def log(msg: str, *, prefix: str = "scan") -> None:
    """One progress line on stderr, unless CODECITY_QUIET is set."""
    if not quiet():
        print(f"[{prefix}] {msg}", file=sys.stderr, flush=True)


class Throttle(Generic[T]):
    """Rate-limits `emit` to one call per PROGRESS_THROTTLE_S.

    ``flush`` then sends the most recent value if the throttle swallowed it, so
    the last thing the client sees is the true final value rather than whatever
    happened to fall outside the window. A no-op when there is no callback,
    which keeps the call sites free of `if on_progress is not None` guards.
    """

    __slots__ = ("_emit", "_last_at", "_last_sent", "_pending", "_has_pending")

    def __init__(self, emit: Callable[[T], None] | None) -> None:
        self._emit = emit
        self._last_at = 0.0
        self._last_sent: T | None = None
        self._pending: T | None = None
        self._has_pending = False

    def __bool__(self) -> bool:
        """False when there is nothing to emit to, so a caller can skip the
        work of BUILDING a payload it would only throw away."""
        return self._emit is not None

    def send(self, value: T, *, force: bool = False) -> None:
        """Emit `value`, or hold it until the window opens. ``force`` bypasses
        the window for a value that must land (a stage's terminal 100%)."""
        if self._emit is None:
            return
        self._pending, self._has_pending = value, True
        now = time.monotonic()
        if not force and now - self._last_at < PROGRESS_THROTTLE_S:
            return
        self._emit(value)
        self._last_at, self._last_sent, self._has_pending = now, value, False

    def flush(self) -> None:
        """Send the last held value if it never went out."""
        if self._emit is None or not self._has_pending:
            return
        if self._pending != self._last_sent:
            self._emit(self._pending)  # type: ignore[arg-type]
            self._last_sent = self._pending
        self._has_pending = False


class Heartbeat:
    """Per-scan file counter. Per-scan and not global because concurrent
    /api/manifest requests would otherwise share and garble one tally."""

    __slots__ = ("seen", "_throttle")

    def __init__(self, on_progress: Callable[[int], None] | None = None) -> None:
        self.seen = 0
        self._throttle: Throttle[int] = Throttle(on_progress)

    def tick(self) -> None:
        self.seen += 1
        if self.seen % 100 == 0:
            log(f"  walked {self.seen} files so far…")
        self._throttle.send(self.seen)

    def flush(self) -> None:
        """Emit the true final count, which the throttle may have swallowed."""
        self._throttle.flush()
