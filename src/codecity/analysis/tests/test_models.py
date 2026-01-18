from datetime import datetime, timezone

from codecity.analysis.models import Building, City, FileMetrics, Street


def test_file_metrics_creation() -> None:
    now = datetime.now(timezone.utc)
    metrics = FileMetrics(
        path="src/main.py",
        lines_of_code=100,
        avg_line_length=45.5,
        language="python",
        created_at=now,
        last_modified=now,
    )
    assert metrics.path == "src/main.py"
    assert metrics.lines_of_code == 100
    assert metrics.language == "python"


def test_building_from_file_metrics() -> None:
    now = datetime.now(timezone.utc)
    metrics = FileMetrics(
        path="src/main.py",
        lines_of_code=100,
        avg_line_length=40.0,
        language="python",
        created_at=now,
        last_modified=now,
    )
    building = Building.from_metrics(metrics)
    assert building.height == 100
    assert building.width == 40.0
    assert building.file_path == "src/main.py"


def test_street_can_contain_buildings() -> None:
    street = Street(path="src/", name="src")
    assert street.buildings == []
    assert street.substreets == []


def test_city_has_root_street() -> None:
    city = City(root=Street(path="", name="root"))
    assert city.root.name == "root"


def test_street_has_color_field() -> None:
    street = Street(path="src", name="src", color=(89, 98, 117))
    assert street.color == (89, 98, 117)


def test_street_has_road_width_field() -> None:
    street = Street(path="src", name="src", road_width=2.0)
    assert street.road_width == 2.0


def test_street_default_color_is_none() -> None:
    street = Street(path="src", name="src")
    assert street.color is None


def test_street_default_road_width() -> None:
    street = Street(path="src", name="src")
    assert street.road_width == 1.5
