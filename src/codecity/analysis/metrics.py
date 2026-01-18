# src/codecity/analysis/metrics.py
from pathlib import Path
from typing import TypedDict

from codecity.config.defaults import get_language_from_extension


class FileMetricsDict(TypedDict):
    lines_of_code: int
    avg_line_length: float
    language: str


def calculate_file_metrics(file_path: Path) -> FileMetricsDict:
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except (OSError, UnicodeDecodeError):
        return {
            "lines_of_code": 0,
            "avg_line_length": 0.0,
            "language": "unknown",
        }

    lines = content.splitlines()
    lines_of_code = len(lines)

    if lines_of_code == 0:
        avg_line_length = 0.0
    else:
        total_length = sum(len(line) for line in lines)
        avg_line_length = total_length / lines_of_code

    language = get_language_from_extension(file_path.suffix)

    return {
        "lines_of_code": lines_of_code,
        "avg_line_length": round(avg_line_length, 2),
        "language": language,
    }
