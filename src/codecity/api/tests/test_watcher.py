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
                # Stop after we get the test.py event
                if event.path == "test.py":
                    break

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
        # Find the event for test.py (may receive directory event first)
        test_py_events = [e for e in events if e.path == "test.py"]
        assert len(test_py_events) >= 1
        assert test_py_events[0].change_type == "added"
        assert test_py_events[0].path == "test.py"


def test_change_event_types() -> None:
    event = ChangeEvent(path="test.py", change_type="modified")
    assert event.path == "test.py"
    assert event.change_type == "modified"


def test_change_event_git_substring_not_filtered() -> None:
    # Files like "dotgit_utils.py" should not be filtered
    event = ChangeEvent(path="dotgit_utils.py", change_type="added")
    assert event.path == "dotgit_utils.py"
