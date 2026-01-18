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


def test_layout_subfolders_do_not_overlap_parent_buildings():
    """Buildings from subfolders should not overlap with parent folder buildings."""
    metrics = {
        "src/main.py": make_file_metrics("src/main.py"),
        "src/utils.py": make_file_metrics("src/utils.py"),
        "src/components/Button.tsx": make_file_metrics("src/components/Button.tsx"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]

    def get_bbox(building):
        coords = building["geometry"]["coordinates"][0]
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        return min(xs), min(ys), max(xs), max(ys)

    def boxes_overlap(b1, b2):
        min_x1, min_y1, max_x1, max_y1 = get_bbox(b1)
        min_x2, min_y2, max_x2, max_y2 = get_bbox(b2)
        return not (
            max_x1 < min_x2 or max_x2 < min_x1 or max_y1 < min_y2 or max_y2 < min_y1
        )

    # Check no buildings overlap
    for i, b1 in enumerate(buildings):
        for b2 in buildings[i + 1 :]:
            assert not boxes_overlap(b1, b2), (
                f"Buildings overlap: {b1['properties']['name']} and {b2['properties']['name']}"
            )


def test_layout_creates_sidewalks_for_streets():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    sidewalks = [
        f for f in result["features"] if f["properties"]["layer"] == "sidewalks"
    ]
    # Each street should have 2 sidewalks (left and right)
    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    assert len(sidewalks) == len(streets) * 2

    # Check sidewalk properties
    src_sidewalks = [s for s in sidewalks if s["properties"]["street"] == "src"]
    assert len(src_sidewalks) == 2
    sides = {s["properties"]["side"] for s in src_sidewalks}
    assert sides == {"left", "right"}


def test_layout_creates_footpath_for_each_building():
    metrics = {
        "src/main.py": make_file_metrics("src/main.py"),
        "src/utils.py": make_file_metrics("src/utils.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    footpaths = [
        f for f in result["features"] if f["properties"]["layer"] == "footpaths"
    ]
    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]
    # One footpath per building
    assert len(footpaths) == len(buildings)

    # Check footpath has multiple points (curved)
    for fp in footpaths:
        coords = fp["geometry"]["coordinates"]
        assert len(coords) >= 3, "Footpath should have at least 3 points for curve"
