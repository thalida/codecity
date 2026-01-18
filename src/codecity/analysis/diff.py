# src/codecity/analysis/diff.py
from dataclasses import dataclass, field


@dataclass
class DiffResult:
    added: set[str] = field(default_factory=set)
    removed: set[str] = field(default_factory=set)
    modified: set[str] = field(default_factory=set)

    @property
    def is_empty(self) -> bool:
        return not self.added and not self.removed and not self.modified

    @property
    def all_changed(self) -> set[str]:
        return self.added | self.removed | self.modified


def calculate_diff(
    old_files: set[str],
    new_files: set[str],
    modified_hints: set[str] | None = None,
) -> DiffResult:
    """Calculate the difference between two sets of files."""
    added = new_files - old_files
    removed = old_files - new_files

    # Modified files are those in both sets that are marked as modified
    if modified_hints:
        modified = modified_hints & old_files & new_files
    else:
        modified = set()

    return DiffResult(added=added, removed=removed, modified=modified)
