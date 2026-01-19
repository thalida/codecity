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


def test_layout_street_traffic_based_road_class():
    """Test that road class is based on descendant count (traffic-based hierarchy).

    The layout uses a traffic-based model where:
    - Roads with 50+ descendants are primary (high traffic)
    - Roads with 10-49 descendants are secondary (medium traffic)
    - Roads with <10 descendants are tertiary (low traffic)
    """
    # Create enough files to trigger different road classes
    metrics = {}
    # Create 60 files in various locations to make the root primary
    for i in range(25):
        path = f"src/components/file{i}.py"
        metrics[path] = make_file_metrics(path)
    for i in range(25):
        path = f"src/utils/file{i}.py"
        metrics[path] = make_file_metrics(path)
    for i in range(10):
        path = f"docs/file{i}.md"
        metrics[path] = make_file_metrics(path)

    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics, root_name="myproject")

    # Filter to named streets only (not connectors)
    streets = [
        f
        for f in result["features"]
        if f["properties"]["layer"] == "streets" and f["properties"]["name"]
    ]

    # Main street has all 60 descendants - should be primary
    main_street = next(s for s in streets if s["properties"]["name"] == "myproject")
    assert main_street["properties"]["road_class"] == "primary"
    assert main_street["properties"]["descendant_count"] == 60

    # src has 50 descendants - should be primary
    src_street = next(s for s in streets if s["properties"]["name"] == "src")
    assert src_street["properties"]["road_class"] == "primary"
    assert src_street["properties"]["descendant_count"] == 50

    # docs has 10 descendants - should be secondary
    docs_street = next(s for s in streets if s["properties"]["name"] == "docs")
    assert docs_street["properties"]["road_class"] == "secondary"
    assert docs_street["properties"]["descendant_count"] == 10

    # components has 25 descendants - should be secondary
    components_street = next(
        s for s in streets if s["properties"]["name"] == "components"
    )
    assert components_street["properties"]["road_class"] == "secondary"
    assert components_street["properties"]["descendant_count"] == 25


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
            assert not boxes_overlap(
                b1, b2
            ), f"Buildings overlap: {b1['properties']['name']} and {b2['properties']['name']}"


def test_layout_creates_sidewalks_for_streets():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    sidewalks = [
        f for f in result["features"] if f["properties"]["layer"] == "sidewalks"
    ]
    # Named streets (not connectors) should have 2 sidewalks each (left and right)
    # Connector streets (paths like "root>src") don't have sidewalks
    named_streets = [
        f
        for f in result["features"]
        if f["properties"]["layer"] == "streets" and f["properties"]["name"]
    ]
    assert len(sidewalks) == len(named_streets) * 2

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


def test_layout_creates_grass_area():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    grass = [f for f in result["features"] if f["properties"]["layer"] == "grass"]
    assert len(grass) == 1
    assert grass[0]["geometry"]["type"] == "Polygon"
    # Grass should cover the bounds
    coords = grass[0]["geometry"]["coordinates"][0]
    assert len(coords) == 5  # Closed polygon


def test_layout_deep_nesting_no_overlaps():
    """Test that deeply nested folder structures have no overlapping elements."""
    # Simulate a realistic project structure with multiple levels
    metrics = {
        # Root files
        "README.md": make_file_metrics("README.md"),
        "setup.py": make_file_metrics("setup.py"),
        # src folder
        "src/main.py": make_file_metrics("src/main.py"),
        "src/__init__.py": make_file_metrics("src/__init__.py"),
        # src/api folder
        "src/api/__init__.py": make_file_metrics("src/api/__init__.py"),
        "src/api/routes.py": make_file_metrics("src/api/routes.py"),
        "src/api/handlers.py": make_file_metrics("src/api/handlers.py"),
        # src/api/tests folder
        "src/api/tests/__init__.py": make_file_metrics("src/api/tests/__init__.py"),
        "src/api/tests/test_routes.py": make_file_metrics(
            "src/api/tests/test_routes.py"
        ),
        # src/models folder
        "src/models/__init__.py": make_file_metrics("src/models/__init__.py"),
        "src/models/user.py": make_file_metrics("src/models/user.py"),
        # src/utils folder
        "src/utils/__init__.py": make_file_metrics("src/utils/__init__.py"),
        "src/utils/helpers.py": make_file_metrics("src/utils/helpers.py"),
        # docs folder
        "docs/index.md": make_file_metrics("docs/index.md"),
        "docs/api.md": make_file_metrics("docs/api.md"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]
    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]

    def get_bbox(feature):
        coords = feature["geometry"]["coordinates"]
        if feature["geometry"]["type"] == "Polygon":
            coords = coords[0]
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        return min(xs), min(ys), max(xs), max(ys)

    def get_street_bbox(feature):
        coords = feature["geometry"]["coordinates"]
        x1, y1 = coords[0]
        x2, y2 = coords[1]
        # Use a small half-width for street collision detection
        # Scale relative to coordinate range (coordinates span ~0.01 degrees)
        half_width = 0.00002
        if abs(y2 - y1) < 0.0001:  # Horizontal (threshold scaled down)
            return min(x1, x2), y1 - half_width, max(x1, x2), y1 + half_width
        else:  # Vertical
            return x1 - half_width, min(y1, y2), x1 + half_width, max(y1, y2)

    def boxes_overlap(b1, b2):
        min_x1, min_y1, max_x1, max_y1 = b1
        min_x2, min_y2, max_x2, max_y2 = b2
        return not (
            max_x1 < min_x2 or max_x2 < min_x1 or max_y1 < min_y2 or max_y2 < min_y1
        )

    # Check no buildings overlap with each other
    for i, b1 in enumerate(buildings):
        bbox1 = get_bbox(b1)
        for b2 in buildings[i + 1 :]:
            bbox2 = get_bbox(b2)
            assert not boxes_overlap(
                bbox1, bbox2
            ), f"Buildings overlap: {b1['properties']['path']} and {b2['properties']['path']}"

    # Check no buildings overlap with streets they don't belong to
    for street in streets:
        street_bbox = get_street_bbox(street)
        street_path = street["properties"]["path"]
        for building in buildings:
            # Skip buildings that belong to this street
            if building["properties"]["street"] == street_path:
                continue
            building_bbox = get_bbox(building)
            assert not boxes_overlap(
                street_bbox, building_bbox
            ), f"Building {building['properties']['path']} overlaps with street {street_path}"
