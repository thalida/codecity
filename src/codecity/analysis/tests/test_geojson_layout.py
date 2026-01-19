# src/codecity/analysis/tests/test_geojson_layout.py
from datetime import datetime, timezone

from codecity.analysis.geojson_layout import (
    MAX_BUILDING_WIDTH,
    MIN_BUILDING_WIDTH,
    GeoJSONLayoutEngine,
    _trimmed_average,
    calculate_num_tiers,
    calculate_tier_widths,
)
from codecity.analysis.models import FileMetrics


def make_file_metrics(path: str, loc: int = 100, avg_len: float = 40.0) -> FileMetrics:
    """Helper to create FileMetrics for tests.

    Generates realistic line_lengths data based on loc and avg_len parameters,
    matching the data flow from the real metrics calculation system.
    """
    now = datetime.now(timezone.utc)
    # Generate realistic line_lengths array based on loc and avg_len
    # This matches what calculate_file_metrics() produces in production
    line_lengths = [int(avg_len)] * loc
    return FileMetrics(
        path=path,
        lines_of_code=loc,
        avg_line_length=avg_len,
        language="python",
        created_at=now,
        last_modified=now,
        line_lengths=line_lengths,
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
    # With multi-tier buildings, a file may produce multiple building features
    # At minimum, there should be at least 1 building
    assert len(buildings) >= 1
    # All buildings for this file should have the same name and path
    main_buildings = [b for b in buildings if b["properties"]["path"] == "src/main.py"]
    assert len(main_buildings) >= 1
    assert main_buildings[0]["properties"]["name"] == "main.py"
    assert main_buildings[0]["geometry"]["type"] == "Polygon"


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
    # With multi-tier buildings, count unique file paths instead of total building features
    unique_paths = set(b["properties"]["path"] for b in buildings)
    assert len(unique_paths) == 2

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

    # Check no buildings from DIFFERENT files overlap
    # (tiers of the same building are allowed to overlap since they stack vertically)
    for i, b1 in enumerate(buildings):
        for b2 in buildings[i + 1 :]:
            # Skip comparison if buildings are from the same file (different tiers)
            if b1["properties"]["path"] == b2["properties"]["path"]:
                continue
            assert not boxes_overlap(
                b1, b2
            ), f"Buildings overlap: {b1['properties']['name']} and {b2['properties']['name']}"


def test_layout_no_sidewalks():
    """Buildings sit directly beside streets without sidewalks."""
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    sidewalks = [
        f for f in result["features"] if f["properties"]["layer"] == "sidewalks"
    ]
    # Sidewalks are disabled - buildings directly beside streets
    assert len(sidewalks) == 0


def test_layout_no_footpaths():
    """Footpaths are disabled along with sidewalks."""
    metrics = {
        "src/main.py": make_file_metrics("src/main.py"),
        "src/utils.py": make_file_metrics("src/utils.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    footpaths = [
        f for f in result["features"] if f["properties"]["layer"] == "footpaths"
    ]
    # Footpaths are disabled - buildings directly beside streets
    assert len(footpaths) == 0


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

    # Check no buildings from DIFFERENT files overlap with each other
    # (tiers of the same building are allowed to overlap since they stack vertically)
    for i, b1 in enumerate(buildings):
        bbox1 = get_bbox(b1)
        for b2 in buildings[i + 1 :]:
            # Skip comparison if buildings are from the same file (different tiers)
            if b1["properties"]["path"] == b2["properties"]["path"]:
                continue
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


def test_layout_buildings_beside_streets():
    """Buildings should sit directly beside streets (no sidewalk gap)."""
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]

    # Find a building and its associated street
    src_buildings = [b for b in buildings if b["properties"]["street"] == "src"]
    src_street = next(s for s in streets if s["properties"]["path"] == "src")

    assert len(src_buildings) >= 1, "Should have at least one building on src street"

    # Buildings should be positioned near the street
    # Street is vertical, so check x-coordinates
    street_coords = src_street["geometry"]["coordinates"]
    street_x = street_coords[0][0]

    for building in src_buildings:
        coords = building["geometry"]["coordinates"][0]
        building_xs = [c[0] for c in coords[:-1]]  # Exclude closing coord
        building_center_x = sum(building_xs) / len(building_xs)

        # Building center should be within reasonable distance from street
        # (half street width + half max building width, roughly)
        distance = abs(building_center_x - street_x)
        max_expected = 0.01  # Normalized coordinate distance
        assert (
            distance <= max_expected
        ), f"Building too far from street: distance={distance}"


def test_layout_street_extends_to_cover_all_branch_points():
    """Street length must cover all subfolder branch points.

    When a folder has both direct files AND subfolders, the subfolder branch
    points are positioned after the building space. The street must extend
    far enough to cover all these branch points.
    """
    metrics = {
        # Direct files in src - these create building_space
        "src/main.py": make_file_metrics("src/main.py"),
        "src/utils.py": make_file_metrics("src/utils.py"),
        "src/config.py": make_file_metrics("src/config.py"),
        # Subfolders - branch points are positioned after the buildings
        "src/a/file1.py": make_file_metrics("src/a/file1.py"),
        "src/b/file2.py": make_file_metrics("src/b/file2.py"),
        "src/c/file3.py": make_file_metrics("src/c/file3.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]

    # Find src street and its child connectors
    src_street = next(s for s in streets if s["properties"]["path"] == "src")
    connectors = [s for s in streets if s["properties"]["path"].startswith("src>src/")]

    # Get src street extent (src is a vertical street branching from root)
    src_coords = src_street["geometry"]["coordinates"]
    # For a vertical street, check y coordinates
    src_ys = [c[1] for c in src_coords]
    src_start_y = min(src_ys)
    src_end_y = max(src_ys)

    # All connector start points must be within src street extent
    for conn in connectors:
        conn_start = conn["geometry"]["coordinates"][0]
        conn_y = conn_start[1]
        assert src_start_y <= conn_y <= src_end_y, (
            f"Connector {conn['properties']['path']} starts at y={conn_y} "
            f"but src street only covers y={src_start_y} to y={src_end_y}"
        )


def test_layout_main_street_extends_to_cover_all_top_level_folders():
    """Main street must extend to cover all top-level folder branch points."""
    metrics = {
        "src/file1.py": make_file_metrics("src/file1.py"),
        "lib/file2.py": make_file_metrics("lib/file2.py"),
        "tests/file3.py": make_file_metrics("tests/file3.py"),
        "docs/file4.py": make_file_metrics("docs/file4.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics, root_name="project")

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]

    # Find main street and top-level connectors
    main_street = next(s for s in streets if s["properties"]["path"] == "root")
    connectors = [s for s in streets if s["properties"]["path"].startswith("root>")]

    # Get main street extent (main street is horizontal)
    main_coords = main_street["geometry"]["coordinates"]
    main_xs = [c[0] for c in main_coords]
    main_start_x = min(main_xs)
    main_end_x = max(main_xs)

    # All connector start points must be within main street extent
    for conn in connectors:
        conn_start = conn["geometry"]["coordinates"][0]
        conn_x = conn_start[0]
        assert main_start_x <= conn_x <= main_end_x, (
            f"Connector {conn['properties']['path']} starts at x={conn_x} "
            f"but main street only covers x={main_start_x} to x={main_end_x}"
        )


def test_layout_tiered_buildings_are_centered():
    """Each building tier should be centered around the same point."""
    # Create a file with multiple tiers (150 LOC = 3 tiers)
    # line_lengths is now generated by make_file_metrics based on loc and avg_len
    metrics = {"src/main.py": make_file_metrics("src/main.py", loc=150, avg_len=40.0)}

    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]

    main_buildings = [b for b in buildings if b["properties"]["path"] == "src/main.py"]
    assert len(main_buildings) >= 2, "Should have multiple tiers"

    # Calculate center of each tier
    centers = []
    for building in main_buildings:
        coords = building["geometry"]["coordinates"][0]
        xs = [c[0] for c in coords[:-1]]  # Exclude closing coord
        ys = [c[1] for c in coords[:-1]]
        center_x = sum(xs) / len(xs)
        center_y = sum(ys) / len(ys)
        centers.append((center_x, center_y))

    # All tiers should share the same center (within tolerance)
    for i, (cx, cy) in enumerate(centers[1:], 1):
        assert (
            abs(cx - centers[0][0]) < 0.0001
        ), f"Tier {i} center x={cx} differs from tier 0 center x={centers[0][0]}"
        assert (
            abs(cy - centers[0][1]) < 0.0001
        ), f"Tier {i} center y={cy} differs from tier 0 center y={centers[0][1]}"


def test_layout_tiered_buildings_have_square_footprint():
    """Each building tier should have equal width and depth (square footprint)."""
    # Create a file with multiple tiers
    # line_lengths is now generated by make_file_metrics based on loc and avg_len
    metrics = {"src/main.py": make_file_metrics("src/main.py", loc=150, avg_len=40.0)}

    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]

    main_buildings = [b for b in buildings if b["properties"]["path"] == "src/main.py"]

    for building in main_buildings:
        coords = building["geometry"]["coordinates"][0]
        xs = [c[0] for c in coords[:-1]]
        ys = [c[1] for c in coords[:-1]]

        width = max(xs) - min(xs)
        depth = max(ys) - min(ys)

        # Width and depth should be equal (square footprint)
        assert abs(width - depth) < 0.0001, (
            f"Tier {building['properties']['tier']} not square: "
            f"width={width}, depth={depth}"
        )


def test_calculate_num_tiers():
    """Number of tiers based on lines of code."""
    assert calculate_num_tiers(10) == 1  # Small file
    assert calculate_num_tiers(50) == 1  # Still 1 tier
    assert calculate_num_tiers(51) == 2  # 2 tiers
    assert calculate_num_tiers(100) == 2
    assert calculate_num_tiers(101) == 3
    assert calculate_num_tiers(200) == 3
    assert calculate_num_tiers(201) == 4
    assert calculate_num_tiers(400) == 4
    assert calculate_num_tiers(401) == 5
    assert calculate_num_tiers(4001) == 10  # Max tiers


def test_trimmed_average():
    """Trimmed average should exclude top/bottom 10% outliers."""
    # With outliers: [1, 1, 40, 40, 40, 40, 40, 40, 100, 100]
    # After trimming 10% (1 from each end): [1, 40, 40, 40, 40, 40, 40, 100]
    values = [1, 1, 40, 40, 40, 40, 40, 40, 100, 100]
    avg = _trimmed_average(values)
    # Should be closer to 40 than simple average would be
    simple_avg = sum(values) / len(values)
    assert avg < simple_avg  # Trimmed excludes high outliers
    assert avg > 35  # Should be close to 40

    # Empty list returns default
    assert _trimmed_average([]) == 40.0

    # Very few values - no trimming
    assert _trimmed_average([10, 20]) == 15.0


def test_calculate_tier_widths_per_section():
    """Tier widths should reflect the line lengths in each section."""
    # File with varying line lengths across sections
    # Use values that after /2 scaling stay within MIN (6) and MAX (16) bounds:
    # Section 1 (bottom tier): 14 chars -> 7 width
    # Section 2 (middle tier): 20 chars -> 10 width
    # Section 3 (top tier): 28 chars -> 14 width
    line_lengths = [14] * 34 + [20] * 33 + [28] * 33  # 100 lines total

    widths = calculate_tier_widths(line_lengths, 3)

    assert len(widths) == 3
    # Bottom tier has short lines -> narrower
    # Middle tier has medium lines -> medium width
    # Top tier has long lines -> wider
    assert (
        widths[0] < widths[1] < widths[2]
    ), f"Widths should increase with line length: {widths}"


def test_calculate_tier_widths_uniform_lines():
    """Uniform line lengths should produce uniform tier widths (pillar shape)."""
    line_lengths = [40] * 100  # All lines same length
    widths = calculate_tier_widths(line_lengths, 3)

    assert len(widths) == 3
    # All tiers should have approximately the same width
    assert abs(widths[0] - widths[1]) < 0.01
    assert abs(widths[1] - widths[2]) < 0.01


def test_calculate_tier_widths_clamped():
    """Tier widths should be clamped to MIN and MAX."""
    # Very short lines (5 chars) - scaled to 2.5, should clamp to MIN_BUILDING_WIDTH
    short_lines = [5] * 10
    widths = calculate_tier_widths(short_lines, 1)
    assert widths[0] == MIN_BUILDING_WIDTH

    # Very long lines (100 chars) - scaled to 50, should clamp to MAX_BUILDING_WIDTH
    long_lines = [100] * 10
    widths = calculate_tier_widths(long_lines, 1)
    assert widths[0] == MAX_BUILDING_WIDTH


def test_layout_creates_tiered_buildings():
    """Large files should produce multiple building tiers."""
    # Create a file with 150 lines (should be 3 tiers)
    # line_lengths is now generated by make_file_metrics based on loc and avg_len
    metrics = {"src/main.py": make_file_metrics("src/main.py", loc=150, avg_len=40.0)}

    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]

    # Should have 3 tiers for 150 LOC file
    main_buildings = [b for b in buildings if b["properties"]["path"] == "src/main.py"]
    assert len(main_buildings) == 3, f"Expected 3 tiers, got {len(main_buildings)}"

    # Verify tier numbers
    tiers = sorted([b["properties"]["tier"] for b in main_buildings])
    assert tiers == [0, 1, 2]

    # Verify heights are stacked
    main_buildings_sorted = sorted(
        main_buildings, key=lambda b: b["properties"]["tier"]
    )
    for i, b in enumerate(main_buildings_sorted):
        if i > 0:
            prev = main_buildings_sorted[i - 1]
            assert (
                b["properties"]["base_height"] == prev["properties"]["top_height"]
            ), f"Tier {i} base should equal tier {i - 1} top"
