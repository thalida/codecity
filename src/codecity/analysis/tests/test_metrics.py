# src/codecity/analysis/tests/test_metrics.py
from pathlib import Path

from codecity.analysis.metrics import calculate_file_metrics


def test_calculate_lines_of_code(tmp_path: Path) -> None:
    test_file = tmp_path / "test.py"
    test_file.write_text("line 1\nline 2\nline 3\n")
    metrics = calculate_file_metrics(test_file)
    assert metrics["lines_of_code"] == 3


def test_calculate_avg_line_length(tmp_path: Path) -> None:
    test_file = tmp_path / "test.py"
    test_file.write_text("1234567890\n12345\n123456789012345\n")
    metrics = calculate_file_metrics(test_file)
    assert metrics["avg_line_length"] == 10.0  # (10+5+15)/3


def test_detect_language_from_extension(tmp_path: Path) -> None:
    test_file = tmp_path / "test.py"
    test_file.write_text("print('hello')\n")
    metrics = calculate_file_metrics(test_file)
    assert metrics["language"] == "python"


def test_empty_file_returns_zero_metrics(tmp_path: Path) -> None:
    test_file = tmp_path / "test.py"
    test_file.write_text("")
    metrics = calculate_file_metrics(test_file)
    assert metrics["lines_of_code"] == 0
    assert metrics["avg_line_length"] == 0.0


def test_nonexistent_file_returns_default_metrics() -> None:
    nonexistent_path = Path("/nonexistent/path/to/file.py")
    metrics = calculate_file_metrics(nonexistent_path)
    assert metrics["lines_of_code"] == 0
    assert metrics["avg_line_length"] == 0.0
    assert metrics["language"] == "unknown"
