# src/codecity/analysis/tests/test_metrics.py
import tempfile
from pathlib import Path

from codecity.analysis.metrics import calculate_file_metrics


def test_calculate_lines_of_code() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("line 1\n")
        f.write("line 2\n")
        f.write("line 3\n")
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["lines_of_code"] == 3


def test_calculate_avg_line_length() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("1234567890\n")  # 10 chars
        f.write("12345\n")  # 5 chars
        f.write("123456789012345\n")  # 15 chars
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["avg_line_length"] == 10.0  # (10+5+15)/3


def test_detect_language_from_extension() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("print('hello')\n")
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["language"] == "python"


def test_empty_file_returns_zero_metrics() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["lines_of_code"] == 0
        assert metrics["avg_line_length"] == 0.0
