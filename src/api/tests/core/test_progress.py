"""The scan heartbeat's throttling and terminal flush."""

from __future__ import annotations


from api.core.progress import Heartbeat  # noqa: F401


def test_heartbeat_calls_progress_callback_throttled():
    """The heartbeat should fire the callback at most once per ~250ms
    even if tick() is called rapidly."""
    import time
    from unittest.mock import MagicMock

    cb = MagicMock()
    hb = Heartbeat(on_progress=cb)

    for _ in range(1000):
        hb.tick()

    initial_count = cb.call_count
    assert initial_count >= 1, "expected at least one callback during the rapid ticks"
    assert initial_count < 50, (
        f"expected throttling to keep count low, got {initial_count}"
    )

    time.sleep(0.3)
    hb.tick()
    assert cb.call_count > initial_count, (
        "expected a new callback after throttle window"
    )


def test_heartbeat_flush_emits_terminal_count():
    """flush() must emit the final seen count when the last tick was
    throttle-suppressed, so the UI never freezes at a stale value."""
    from unittest.mock import MagicMock

    cb = MagicMock()
    hb = Heartbeat(on_progress=cb)

    # Rapid ticks: throttle blocks all but the first (or first few).
    for _ in range(1000):
        hb.tick()
    ticks_before_flush = cb.call_count
    last_emitted_count_before_flush = cb.call_args.args[0]

    # The heartbeat's seen count is 1000 but the last emit was much earlier.
    assert hb.seen == 1000
    assert last_emitted_count_before_flush < 1000, (
        "throttle should have suppressed late ticks"
    )

    hb.flush()
    assert cb.call_count == ticks_before_flush + 1, "flush should emit exactly once"
    assert cb.call_args.args[0] == 1000, "flush must emit the true terminal count"

    # Flushing again with no new ticks is a no-op.
    hb.flush()
    assert cb.call_count == ticks_before_flush + 1


def test_heartbeat_flush_noop_when_already_emitted():
    """flush() must not re-emit a count that was already emitted."""
    import time
    from unittest.mock import MagicMock

    cb = MagicMock()
    hb = Heartbeat(on_progress=cb)

    hb.tick()
    assert cb.call_count == 1
    # Sleep past the throttle window so the next tick emits.
    time.sleep(0.3)
    hb.tick()
    assert cb.call_count == 2

    # No new ticks between the last emit and flush: should be a no-op.
    hb.flush()
    assert cb.call_count == 2
