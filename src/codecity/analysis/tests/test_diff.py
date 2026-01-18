# src/codecity/analysis/tests/test_diff.py
from codecity.analysis.diff import DiffResult, calculate_diff


def test_diff_detects_added_files() -> None:
    old_files = {"a.py", "b.py"}
    new_files = {"a.py", "b.py", "c.py"}

    diff = calculate_diff(old_files, new_files)
    assert diff.added == {"c.py"}
    assert diff.removed == set()
    assert diff.modified == set()


def test_diff_detects_removed_files() -> None:
    old_files = {"a.py", "b.py", "c.py"}
    new_files = {"a.py", "b.py"}

    diff = calculate_diff(old_files, new_files)
    assert diff.added == set()
    assert diff.removed == {"c.py"}


def test_diff_with_modified_hints() -> None:
    old_files = {"a.py", "b.py"}
    new_files = {"a.py", "b.py"}
    modified_hints = {"a.py"}  # From file watcher

    diff = calculate_diff(old_files, new_files, modified_hints)
    assert diff.modified == {"a.py"}


def test_diff_is_empty_returns_true_when_no_changes() -> None:
    diff = DiffResult(added=set(), removed=set(), modified=set())
    assert diff.is_empty is True


def test_diff_is_empty_returns_false_when_changes() -> None:
    diff = DiffResult(added={"a.py"}, removed=set(), modified=set())
    assert diff.is_empty is False
