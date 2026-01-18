# src/codecity/analysis/tests/test_geojson_layout.py
from datetime import datetime, timezone

from codecity.analysis.geojson_layout import GeoJSONLayoutEngine
from codecity.analysis.models import FileMetrics


def make_file_metrics(path: str, loc: int = 100, avg_len: float = 40.0) -> FileMetrics:
    """Helper to create FileMetrics for tests."""
    now = datetime.now(timezone.utc)
    return FileMetrics(
        path=path,
        lines_of_code=loc,
        avg_line_length=avg_len,
        language="python",
        created_at=now,
        last_modified=now,
    )


def test_layout_returns_geojson_feature_collection():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    assert result["type"] == "FeatureCollection"
    assert "features" in result
    assert isinstance(result["features"], list)


def test_layout_creates_street_for_folder():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    assert len(streets) >= 1

    src_street = next((s for s in streets if s["properties"]["name"] == "src"), None)
    assert src_street is not None
    assert src_street["geometry"]["type"] == "LineString"


def test_layout_creates_building_for_file():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]
    assert len(buildings) == 1
    assert buildings[0]["properties"]["name"] == "main.py"
    assert buildings[0]["geometry"]["type"] == "Polygon"


def test_layout_nested_folders_create_multiple_streets():
    metrics = {
        "src/components/Button.tsx": make_file_metrics("src/components/Button.tsx"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    street_names = [s["properties"]["name"] for s in streets]

    assert "src" in street_names
    assert "components" in street_names


def test_layout_multiple_files_same_folder():
    metrics = {
        "src/main.py": make_file_metrics("src/main.py"),
        "src/utils.py": make_file_metrics("src/utils.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]
    assert len(buildings) == 2

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    src_streets = [s for s in streets if s["properties"]["name"] == "src"]
    assert len(src_streets) == 1  # Only one "src" street


def test_layout_street_depth_affects_road_class():
    metrics = {
        "src/components/utils/helpers.py": make_file_metrics(
            "src/components/utils/helpers.py"
        ),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]

    src_street = next(s for s in streets if s["properties"]["name"] == "src")
    components_street = next(
        s for s in streets if s["properties"]["name"] == "components"
    )
    utils_street = next(s for s in streets if s["properties"]["name"] == "utils")

    assert src_street["properties"]["road_class"] == "primary"
    assert components_street["properties"]["road_class"] == "secondary"
    assert utils_street["properties"]["road_class"] == "tertiary"


def test_layout_buildings_have_valid_polygon_coords():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]
    building = buildings[0]

    coords = building["geometry"]["coordinates"][0]
    # Polygon must be closed (first == last)
    assert coords[0] == coords[-1]
    # Must have at least 4 unique corners + 1 closing = 5 points
    assert len(coords) >= 5
