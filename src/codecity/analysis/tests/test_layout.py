from datetime import datetime, timezone

from codecity.analysis.layout import generate_city_layout
from codecity.analysis.models import FileMetrics


def test_layout_generates_city_from_metrics() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    assert city.root is not None
    assert city.repo_path == "/repo/path"


def test_layout_creates_streets_for_folders() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils/helpers.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")

    # Root should have 'src' street
    assert len(city.root.substreets) == 1
    src_street = city.root.substreets[0]
    assert src_street.name == "src"


def test_layout_places_buildings_on_streets() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    assert len(city.root.buildings) == 1
    assert city.root.buildings[0].file_path == "main.py"
