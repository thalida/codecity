# src/codecity/api/tests/test_watcher.py
import asyncio
import tempfile
from pathlib import Path

import pytest

from codecity.api.watcher import ChangeEvent, FileWatcher


@pytest.mark.asyncio
async def test_watcher_detects_file_creation() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        watcher = FileWatcher(Path(tmpdir))
        events: list[ChangeEvent] = []

        async def collect_events():
            async for event in watcher.watch():
                events.append(event)
                break  # Stop after first event

        # Start watcher in background
        task = asyncio.create_task(collect_events())

        # Give watcher time to start
        await asyncio.sleep(0.1)

        # Create a file
        (Path(tmpdir) / "test.py").write_text("# new file")

        # Wait for event or timeout
        try:
            await asyncio.wait_for(task, timeout=2.0)
        except asyncio.TimeoutError:
            task.cancel()

        assert len(events) >= 1


def test_change_event_types() -> None:
    event = ChangeEvent(path="test.py", change_type="modified")
    assert event.path == "test.py"
    assert event.change_type == "modified"
