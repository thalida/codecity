# src/codecity/api/watcher.py
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncGenerator, Literal

from watchfiles import Change, awatch

ChangeType = Literal["added", "modified", "deleted"]


@dataclass
class ChangeEvent:
    path: str
    change_type: ChangeType


class FileWatcher:
    def __init__(self, repo_path: Path) -> None:
        self.repo_path = repo_path.resolve()

    async def watch(self) -> AsyncGenerator[ChangeEvent, None]:
        """Watch for file changes and yield events."""
        async for changes in awatch(self.repo_path):
            for change_type, path in changes:
                # Check if .git is a directory component, not just a substring
                path_parts = Path(path).parts
                if ".git" in path_parts:
                    continue

                try:
                    relative_path = str(Path(path).relative_to(self.repo_path))
                except ValueError:
                    continue  # Skip paths outside repo

                if change_type == Change.added:
                    yield ChangeEvent(path=relative_path, change_type="added")
                elif change_type == Change.modified:
                    yield ChangeEvent(path=relative_path, change_type="modified")
                elif change_type == Change.deleted:
                    yield ChangeEvent(path=relative_path, change_type="deleted")
