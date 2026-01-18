from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class FileMetrics:
    path: str
    lines_of_code: int
    avg_line_length: float
    language: str
    created_at: datetime
    last_modified: datetime


@dataclass
class Building:
    file_path: str
    height: float  # lines of code
    width: float  # avg line length
    depth: float  # same as width
    language: str
    created_at: datetime
    last_modified: datetime
    x: float = 0.0
    z: float = 0.0

    @classmethod
    def from_metrics(cls, metrics: FileMetrics) -> "Building":
        return cls(
            file_path=metrics.path,
            height=float(metrics.lines_of_code),
            width=metrics.avg_line_length,
            depth=metrics.avg_line_length,
            language=metrics.language,
            created_at=metrics.created_at,
            last_modified=metrics.last_modified,
        )


@dataclass
class Street:
    path: str
    name: str
    x: float = 0.0
    z: float = 0.0
    width: float = 10.0
    length: float = 100.0
    buildings: list[Building] = field(default_factory=list)
    substreets: list["Street"] = field(default_factory=list)


@dataclass
class City:
    root: Street
    repo_path: str = ""
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
