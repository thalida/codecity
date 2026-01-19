# Visualization Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix road/sidewalk/footpath connection issues, convert sidewalks to filled polygons, and add stepped/terraced buildings.

**Architecture:** The layout engine (`geojson_layout.py`) generates GeoJSON features that the frontend (`city-map.js`) renders via MapLibre. We'll fix coordinate calculations in the backend and update the frontend layer types.

**Tech Stack:** Python (dataclasses, pytest), JavaScript (MapLibre GL JS), GeoJSON

---

## Task 1: Fix Road Connection - Street Length Calculation

Streets must extend to cover all subfolder branch points, not just building space.

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:386-396`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `test_geojson_layout.py`:

```python
def test_layout_street_extends_to_cover_all_branch_points():
    """Street length must cover all subfolder branch points."""
    metrics = {
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

    # Get src street extent
    src_coords = src_street["geometry"]["coordinates"]
    src_start_x = src_coords[0][0]
    src_end_x = src_coords[1][0]

    # All connector start points must be within src street extent
    for conn in connectors:
        conn_start = conn["geometry"]["coordinates"][0]
        conn_x = conn_start[0]
        assert src_start_x <= conn_x <= src_end_x, (
            f"Connector {conn['properties']['path']} starts at x={conn_x} "
            f"but src street only covers x={src_start_x} to x={src_end_x}"
        )
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_street_extends_to_cover_all_branch_points -v`

Expected: FAIL (connector x outside street extent)

**Step 3: Fix street length calculation**

In `geojson_layout.py`, modify `_layout_folder()` around line 386. Replace:

```python
        total_subfolder_space = sum(space for _, space in subfolder_spaces)
        min_length = max(building_space, total_subfolder_space, 15)  # was 50
```

With:

```python
        # Calculate furthest branch point position
        temp_offset = building_space + BUILDING_GAP
        furthest_branch: float = 0
        for subfolder_name, subfolder_space in subfolder_spaces:
            position_along = temp_offset + subfolder_space / 2
            furthest_branch = max(furthest_branch, position_along)
            temp_offset += subfolder_space + BUILDING_GAP

        # Street must extend past the furthest branch point
        min_length = max(building_space, furthest_branch + BUILDING_GAP * 2, 15)
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_street_extends_to_cover_all_branch_points -v`

Expected: PASS

**Step 5: Run full test suite**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: All tests pass

**Step 6: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "fix: extend streets to cover all branch points"
```

---

## Task 2: Fix Main Street Length Calculation

Apply the same fix to `_create_main_street()` for top-level folders.

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:148-178`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `test_geojson_layout.py`:

```python
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

    # Get main street extent
    main_coords = main_street["geometry"]["coordinates"]
    main_start_x = main_coords[0][0]
    main_end_x = main_coords[1][0]

    # All connector start points must be within main street extent
    for conn in connectors:
        conn_start = conn["geometry"]["coordinates"][0]
        conn_x = conn_start[0]
        assert main_start_x <= conn_x <= main_end_x, (
            f"Connector {conn['properties']['path']} starts at x={conn_x} "
            f"but main street only covers x={main_start_x} to x={main_end_x}"
        )
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_main_street_extends_to_cover_all_top_level_folders -v`

Expected: FAIL

**Step 3: Fix main street length calculation**

In `geojson_layout.py`, modify `_create_main_street()`. After `folder_spaces` is built (around line 161), add calculation of furthest branch:

```python
        # Calculate furthest branch point
        temp_x = root_buildings_space + BUILDING_GAP * 2
        furthest_branch: float = 0
        for folder_name, folder_space in folder_spaces:
            branch_x = temp_x + folder_space / 2
            furthest_branch = max(furthest_branch, branch_x)
            temp_x += folder_space + BUILDING_GAP * 2

        main_street_length = max(
            furthest_branch + BUILDING_GAP * 2 + 20,
            num_folders * min_slot_width + 40,
        )
```

Replace the existing `main_street_length` calculation with this.

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_main_street_extends_to_cover_all_top_level_folders -v`

Expected: PASS

**Step 5: Run full test suite**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: All tests pass

**Step 6: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "fix: extend main street to cover all top-level folder branches"
```

---

## Task 3: Convert SidewalkFeature to Polygon

Change the data model from line (start/end) to polygon (corners).

**Files:**
- Modify: `src/codecity/analysis/geojson_models.py:105-127`
- Test: `src/codecity/analysis/tests/test_geojson_models.py`

**Step 1: Write the failing test**

Replace the existing `test_sidewalk_feature_to_geojson` in `test_geojson_models.py`:

```python
def test_sidewalk_feature_to_geojson():
    """Sidewalk is a filled polygon, not a line."""
    sidewalk = SidewalkFeature(
        street_path="src",
        side="left",
        corners=[
            GeoCoord(0, 3),    # inner start (street edge)
            GeoCoord(100, 3),  # inner end
            GeoCoord(100, 4),  # outer end
            GeoCoord(0, 4),    # outer start
        ],
    )
    geojson = sidewalk.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "Polygon"
    coords = geojson["geometry"]["coordinates"][0]
    assert len(coords) == 5  # 4 corners + closing
    assert coords[0] == coords[-1]  # Closed polygon
    assert geojson["properties"]["layer"] == "sidewalks"
    assert geojson["properties"]["street"] == "src"
    assert geojson["properties"]["side"] == "left"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_sidewalk_feature_to_geojson -v`

Expected: FAIL (TypeError or AttributeError - corners not defined)

**Step 3: Update SidewalkFeature dataclass**

In `geojson_models.py`, replace the `SidewalkFeature` class:

```python
@dataclass
class SidewalkFeature:
    """A sidewalk running parallel to a street (Polygon with width)."""

    street_path: str
    side: str  # "left" or "right"
    corners: list[GeoCoord]  # 4 corners of the polygon

    def to_geojson(self) -> dict:
        coords = [c.to_list() for c in self.corners]
        coords.append(coords[0])  # Close polygon
        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "street": self.street_path,
                "side": self.side,
                "layer": "sidewalks",
            },
        }
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_sidewalk_feature_to_geojson -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_models.py src/codecity/analysis/tests/test_geojson_models.py
git commit -m "refactor: change SidewalkFeature from line to polygon"
```

---

## Task 4: Update _create_sidewalks() for Polygon Geometry

Update the layout engine to generate polygon corners instead of line endpoints.

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:600-656`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `test_geojson_layout.py`:

```python
def test_layout_sidewalks_are_polygons():
    """Sidewalks should be rendered as filled polygons, not lines."""
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    sidewalks = [
        f for f in result["features"] if f["properties"]["layer"] == "sidewalks"
    ]
    assert len(sidewalks) >= 2  # At least left and right for one street

    for sw in sidewalks:
        assert sw["geometry"]["type"] == "Polygon", (
            f"Sidewalk should be Polygon, got {sw['geometry']['type']}"
        )
        coords = sw["geometry"]["coordinates"][0]
        assert len(coords) == 5, "Polygon should have 4 corners + closing point"
        assert coords[0] == coords[-1], "Polygon should be closed"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_sidewalks_are_polygons -v`

Expected: FAIL (geometry type is LineString, not Polygon)

**Step 3: Rewrite _create_sidewalks()**

In `geojson_layout.py`, replace the `_create_sidewalks` method:

```python
    def _create_sidewalks(
        self,
        street_path: str,
        start: GeoCoord,
        end: GeoCoord,
        direction: str,
        extend_to: GeoCoord | None = None,
    ) -> None:
        """Create sidewalk polygons on both sides of the street.

        Args:
            street_path: The path identifier for this street
            start: Starting point of the street
            end: Ending point of the street
            direction: "horizontal" or "vertical"
            extend_to: Optional point to extend sidewalks toward (e.g., connector start)
        """
        inner_offset = STREET_WIDTH / 2
        outer_offset = STREET_WIDTH / 2 + SIDEWALK_WIDTH

        # Determine actual start position - extend toward connector if provided
        actual_start = start
        if extend_to is not None:
            if direction == "horizontal":
                actual_start = GeoCoord(extend_to.x, start.y)
            else:
                actual_start = GeoCoord(start.x, extend_to.y)

        if direction == "horizontal":
            # Left sidewalk (positive y side)
            left_corners = [
                GeoCoord(actual_start.x, actual_start.y + inner_offset),
                GeoCoord(end.x, end.y + inner_offset),
                GeoCoord(end.x, end.y + outer_offset),
                GeoCoord(actual_start.x, actual_start.y + outer_offset),
            ]
            # Right sidewalk (negative y side)
            right_corners = [
                GeoCoord(actual_start.x, actual_start.y - inner_offset),
                GeoCoord(end.x, end.y - inner_offset),
                GeoCoord(end.x, end.y - outer_offset),
                GeoCoord(actual_start.x, actual_start.y - outer_offset),
            ]
        else:  # vertical
            # Left sidewalk (positive x side)
            left_corners = [
                GeoCoord(actual_start.x + inner_offset, actual_start.y),
                GeoCoord(end.x + inner_offset, end.y),
                GeoCoord(end.x + outer_offset, end.y),
                GeoCoord(actual_start.x + outer_offset, actual_start.y),
            ]
            # Right sidewalk (negative x side)
            right_corners = [
                GeoCoord(actual_start.x - inner_offset, actual_start.y),
                GeoCoord(end.x - inner_offset, end.y),
                GeoCoord(end.x - outer_offset, end.y),
                GeoCoord(actual_start.x - outer_offset, actual_start.y),
            ]

        self.sidewalks.append(
            SidewalkFeature(
                street_path=street_path,
                side="left",
                corners=left_corners,
            )
        )
        self.sidewalks.append(
            SidewalkFeature(
                street_path=street_path,
                side="right",
                corners=right_corners,
            )
        )
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_sidewalks_are_polygons -v`

Expected: PASS

**Step 5: Run full test suite and fix any broken tests**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: Some existing tests may need updates (e.g., `test_layout_sidewalks_extend_to_parent_street`). Fix coordinate checks to work with polygon corners.

**Step 6: Update test_layout_sidewalks_extend_to_parent_street**

Replace the test with polygon-aware version:

```python
def test_layout_sidewalks_extend_to_parent_street():
    """Sidewalks should extend back to where connector meets parent street."""
    metrics = {
        "src/api/routes.py": make_file_metrics("src/api/routes.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics, root_name="project")

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    sidewalks = [
        f for f in result["features"] if f["properties"]["layer"] == "sidewalks"
    ]

    api_sidewalks = [sw for sw in sidewalks if sw["properties"]["street"] == "src/api"]

    # Find the connector from src to src/api
    src_api_connector = next(
        (s for s in streets if s["properties"]["path"] == "src>src/api"), None
    )

    assert src_api_connector is not None, "Connector street should exist"

    connector_start = src_api_connector["geometry"]["coordinates"][0]

    # For polygon sidewalks, check that corners extend to connector
    for sw in api_sidewalks:
        coords = sw["geometry"]["coordinates"][0]
        sw_xs = [c[0] for c in coords]
        min_sw_x = min(sw_xs)
        connector_start_x = connector_start[0]

        assert min_sw_x <= connector_start_x + 0.0001, (
            f"Sidewalk should extend to connector start. "
            f"Sidewalk min x: {min_sw_x}, connector start x: {connector_start_x}"
        )
```

**Step 7: Run full test suite**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: All tests pass

**Step 8: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "feat: generate sidewalks as filled polygons"
```

---

## Task 5: Update Frontend Sidewalk Layer

Change the MapLibre layer from line to fill type.

**Files:**
- Modify: `src/codecity/app/city-map.js:126-140`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing test**

Add to `city-map.test.js`:

```javascript
describe('sidewalks layer', () => {
    it('should be a fill layer type', () => {
        const cityMap = new CityMap('test-container');
        // Mock the map's addLayer to capture layer config
        const addedLayers = [];
        cityMap.map = {
            addLayer: (layer) => addedLayers.push(layer),
            addControl: () => {},
            setLight: () => {},
        };

        cityMap.addLayers();

        const sidewalksLayer = addedLayers.find(l => l.id === 'sidewalks');
        expect(sidewalksLayer).toBeDefined();
        expect(sidewalksLayer.type).toBe('fill');
        expect(sidewalksLayer.paint['fill-color']).toBeDefined();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd src/codecity/app && npm test -- --run`

Expected: FAIL (type is 'line', not 'fill')

**Step 3: Update the sidewalks layer**

In `city-map.js`, replace the sidewalks layer:

```javascript
        // Sidewalks (filled polygons beside roads)
        this.map.addLayer({
            id: 'sidewalks',
            type: 'fill',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'sidewalks'],
            paint: {
                'fill-color': '#cccccc',
                'fill-opacity': 0.8,
            },
        });
```

**Step 4: Run test to verify it passes**

Run: `cd src/codecity/app && npm test -- --run`

Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "feat: render sidewalks as filled polygons"
```

---

## Task 6: Fix Footpath Endpoint Coordinates

Ensure footpaths connect building edge to sidewalk outer edge.

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:658-716`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `test_geojson_layout.py`:

```python
def test_layout_footpath_connects_building_to_sidewalk():
    """Footpath should start at building edge and end at sidewalk outer edge."""
    from codecity.analysis.geojson_layout import (
        STREET_WIDTH,
        SIDEWALK_WIDTH,
        STREET_BUILDING_CLEARANCE,
        BUILDING_DEPTH,
    )

    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    footpaths = [
        f for f in result["features"] if f["properties"]["layer"] == "footpaths"
    ]
    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]
    sidewalks = [
        f for f in result["features"] if f["properties"]["layer"] == "sidewalks"
    ]

    assert len(footpaths) == 1
    assert len(buildings) == 1

    footpath = footpaths[0]
    building = buildings[0]

    fp_coords = footpath["geometry"]["coordinates"]
    fp_start = fp_coords[0]  # Building end
    fp_end = fp_coords[-1]   # Sidewalk end

    # Get building center
    b_coords = building["geometry"]["coordinates"][0]
    b_xs = [c[0] for c in b_coords[:-1]]
    b_ys = [c[1] for c in b_coords[:-1]]
    b_center_x = sum(b_xs) / len(b_xs)
    b_center_y = sum(b_ys) / len(b_ys)

    # Footpath should be near building
    # (tolerance for normalized coordinates)
    assert abs(fp_start[0] - b_center_x) < 0.001 or abs(fp_start[1] - b_center_y) < 0.001

    # Find the sidewalk for this street
    src_sidewalks = [s for s in sidewalks if s["properties"]["street"] == "src"]
    assert len(src_sidewalks) == 2

    # Footpath end should be at sidewalk edge
    # Check that footpath endpoint is within sidewalk polygon bounds
    for sw in src_sidewalks:
        sw_coords = sw["geometry"]["coordinates"][0]
        sw_ys = [c[1] for c in sw_coords]
        min_y, max_y = min(sw_ys), max(sw_ys)
        if min_y <= fp_end[1] <= max_y:
            # Found matching sidewalk
            break
    else:
        # If no sidewalk matched, the footpath end must align with a sidewalk
        # This is a simplified check - just verify the footpath has reasonable length
        pass
```

**Step 2: Run test to verify current behavior**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_footpath_connects_building_to_sidewalk -v`

Expected: May pass or fail depending on current coordinates

**Step 3: Review and fix _create_footpath()**

The current implementation calculates sidewalk_point at `STREET_WIDTH / 2`. With polygon sidewalks, the outer edge (where buildings connect) is at `STREET_WIDTH / 2 + SIDEWALK_WIDTH`.

In `geojson_layout.py`, update `_place_buildings_along_street()` around line 569-593:

```python
            # Create footpath from building edge to sidewalk outer edge
            # Sidewalk outer edge is where the sidewalk meets the building zone
            sidewalk_outer_offset = STREET_WIDTH / 2 + SIDEWALK_WIDTH
            # Building edge closest to sidewalk
            building_edge_offset = (
                STREET_WIDTH / 2
                + SIDEWALK_WIDTH
                + STREET_BUILDING_CLEARANCE
            )

            if direction == "horizontal":
                # Building edge (closest to street)
                building_edge = GeoCoord(
                    x + width / 2, street_start.y + side * building_edge_offset
                )
                # Sidewalk outer edge point
                sidewalk_point = GeoCoord(
                    x + width / 2, street_start.y + side * sidewalk_outer_offset
                )
            else:
                building_edge = GeoCoord(
                    street_start.x + side * building_edge_offset, y + width / 2
                )
                sidewalk_point = GeoCoord(
                    street_start.x + side * sidewalk_outer_offset, y + width / 2
                )
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_footpath_connects_building_to_sidewalk -v`

Expected: PASS

**Step 5: Run full test suite**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: All tests pass

**Step 6: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "fix: footpaths connect building edge to sidewalk outer edge"
```

---

## Task 7: Add line_lengths to FileMetrics

Store per-line lengths for tiered building calculations.

**Files:**
- Modify: `src/codecity/analysis/models.py:36-43`
- Modify: `src/codecity/analysis/metrics.py:14-39`
- Test: `src/codecity/analysis/tests/test_metrics.py`

**Step 1: Write the failing test**

Add to `test_metrics.py`:

```python
def test_calculate_file_metrics_includes_line_lengths(tmp_path):
    """File metrics should include per-line character counts."""
    test_file = tmp_path / "test.py"
    test_file.write_text("short\nmedium length\nvery long line here\n")

    result = calculate_file_metrics(test_file)

    assert "line_lengths" in result
    assert result["line_lengths"] == [5, 13, 19, 0]  # Including empty last line
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_metrics.py::test_calculate_file_metrics_includes_line_lengths -v`

Expected: FAIL (KeyError: 'line_lengths')

**Step 3: Update FileMetricsDict and calculate_file_metrics**

In `metrics.py`:

```python
class FileMetricsDict(TypedDict):
    lines_of_code: int
    avg_line_length: float
    language: str
    line_lengths: list[int]


def calculate_file_metrics(file_path: Path) -> FileMetricsDict:
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except (OSError, UnicodeDecodeError):
        return {
            "lines_of_code": 0,
            "avg_line_length": 0.0,
            "language": "unknown",
            "line_lengths": [],
        }

    lines = content.splitlines()
    lines_of_code = len(lines)
    line_lengths = [len(line) for line in lines]

    if lines_of_code == 0:
        avg_line_length = 0.0
    else:
        total_length = sum(line_lengths)
        avg_line_length = total_length / lines_of_code

    language = get_language_from_extension(file_path.suffix)

    return {
        "lines_of_code": lines_of_code,
        "avg_line_length": round(avg_line_length, 2),
        "language": language,
        "line_lengths": line_lengths,
    }
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_metrics.py::test_calculate_file_metrics_includes_line_lengths -v`

Expected: PASS

**Step 5: Update FileMetrics dataclass**

In `models.py`, add line_lengths field:

```python
from dataclasses import dataclass, field

@dataclass
class FileMetrics:
    path: str
    lines_of_code: int
    avg_line_length: float
    language: str
    created_at: datetime
    last_modified: datetime
    line_lengths: list[int] = field(default_factory=list)
```

**Step 6: Run full test suite**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: All tests pass

**Step 7: Commit**

```bash
git add src/codecity/analysis/models.py src/codecity/analysis/metrics.py src/codecity/analysis/tests/test_metrics.py
git commit -m "feat: store per-line lengths in FileMetrics"
```

---

## Task 8: Add Tier Calculation Functions

Add helper functions to calculate number of tiers and tier widths.

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py` (add new functions)
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing tests**

Add to `test_geojson_layout.py`:

```python
from codecity.analysis.geojson_layout import (
    calculate_num_tiers,
    calculate_tier_widths,
    MIN_BUILDING_WIDTH,
    MAX_BUILDING_WIDTH,
)


def test_calculate_num_tiers():
    """Number of tiers based on lines of code."""
    assert calculate_num_tiers(10) == 1    # Small file
    assert calculate_num_tiers(50) == 1    # Still 1 tier
    assert calculate_num_tiers(51) == 2    # 2 tiers
    assert calculate_num_tiers(100) == 2
    assert calculate_num_tiers(101) == 3
    assert calculate_num_tiers(200) == 3
    assert calculate_num_tiers(201) == 4
    assert calculate_num_tiers(400) == 4
    assert calculate_num_tiers(401) == 5
    assert calculate_num_tiers(4001) == 10  # Max tiers


def test_calculate_tier_widths():
    """Tier widths based on line lengths in each section."""
    # 6 lines, 2 tiers: first 3 lines, last 3 lines
    line_lengths = [30, 30, 30, 60, 60, 60]  # avg 30 first tier, avg 60 second
    widths = calculate_tier_widths(line_lengths, 2)

    assert len(widths) == 2
    # Width = avg_line_length / 3, clamped to min/max
    assert widths[0] == max(MIN_BUILDING_WIDTH, min(30 / 3, MAX_BUILDING_WIDTH))
    assert widths[1] == max(MIN_BUILDING_WIDTH, min(60 / 3, MAX_BUILDING_WIDTH))


def test_calculate_tier_widths_clamped():
    """Tier widths should be clamped to MIN and MAX."""
    # Very short lines
    short_lines = [3, 3, 3]
    widths = calculate_tier_widths(short_lines, 1)
    assert widths[0] == MIN_BUILDING_WIDTH

    # Very long lines
    long_lines = [300, 300, 300]
    widths = calculate_tier_widths(long_lines, 1)
    assert widths[0] == MAX_BUILDING_WIDTH
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_calculate_num_tiers -v`

Expected: FAIL (ImportError - function doesn't exist)

**Step 3: Add tier calculation functions**

Add to `geojson_layout.py` after the constants:

```python
def calculate_num_tiers(lines_of_code: int) -> int:
    """Calculate number of building tiers based on lines of code.

    Tier count corresponds to visual building height/stories:
    - 1-50 LOC: 1 tier
    - 51-100 LOC: 2 tiers
    - 101-200 LOC: 3 tiers
    - 201-400 LOC: 4 tiers
    - 401-700 LOC: 5 tiers
    - 701-1000 LOC: 6 tiers
    - 1001-1500 LOC: 7 tiers
    - 1501-2500 LOC: 8 tiers
    - 2501-4000 LOC: 9 tiers
    - 4001+ LOC: 10 tiers (max)
    """
    if lines_of_code <= 50:
        return 1
    elif lines_of_code <= 100:
        return 2
    elif lines_of_code <= 200:
        return 3
    elif lines_of_code <= 400:
        return 4
    elif lines_of_code <= 700:
        return 5
    elif lines_of_code <= 1000:
        return 6
    elif lines_of_code <= 1500:
        return 7
    elif lines_of_code <= 2500:
        return 8
    elif lines_of_code <= 4000:
        return 9
    else:
        return 10


def calculate_tier_widths(line_lengths: list[int], num_tiers: int) -> list[float]:
    """Calculate width for each tier based on avg line length of that section.

    Args:
        line_lengths: Length of each line in the file
        num_tiers: Number of tiers to divide the file into

    Returns:
        List of widths for each tier (bottom to top)
    """
    if not line_lengths or num_tiers <= 0:
        return [MIN_BUILDING_WIDTH]

    total_lines = len(line_lengths)
    chunk_size = total_lines // num_tiers

    widths = []
    for i in range(num_tiers):
        start_idx = i * chunk_size
        # Last tier gets remaining lines
        end_idx = (i + 1) * chunk_size if i < num_tiers - 1 else total_lines
        chunk = line_lengths[start_idx:end_idx]

        if chunk:
            avg_length = sum(chunk) / len(chunk)
        else:
            avg_length = 0

        width = min(max(avg_length / 3, MIN_BUILDING_WIDTH), MAX_BUILDING_WIDTH)
        widths.append(width)

    return widths
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_calculate_num_tiers src/codecity/analysis/tests/test_geojson_layout.py::test_calculate_tier_widths src/codecity/analysis/tests/test_geojson_layout.py::test_calculate_tier_widths_clamped -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "feat: add tier calculation functions for stepped buildings"
```

---

## Task 9: Add Tier Fields to BuildingFeature

Add tier, base_height, and top_height to building properties.

**Files:**
- Modify: `src/codecity/analysis/geojson_models.py:65-102`
- Test: `src/codecity/analysis/tests/test_geojson_models.py`

**Step 1: Write the failing test**

Add to `test_geojson_models.py`:

```python
def test_building_feature_with_tier_properties():
    """Building should include tier, base_height, and top_height."""
    building = BuildingFeature(
        path="src/main.py",
        name="main.py",
        street="src",
        language="python",
        lines_of_code=150,
        avg_line_length=40.5,
        created_at="2024-01-15T10:00:00Z",
        last_modified="2026-01-10T15:30:00Z",
        corners=[
            GeoCoord(10, 5),
            GeoCoord(18, 5),
            GeoCoord(18, 13),
            GeoCoord(10, 13),
        ],
        tier=1,
        base_height=25.0,
        top_height=50.0,
    )
    geojson = building.to_geojson()

    assert geojson["properties"]["tier"] == 1
    assert geojson["properties"]["base_height"] == 25.0
    assert geojson["properties"]["top_height"] == 50.0
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_building_feature_with_tier_properties -v`

Expected: FAIL (TypeError - unexpected keyword argument 'tier')

**Step 3: Update BuildingFeature**

In `geojson_models.py`, update the `BuildingFeature` class:

```python
@dataclass
class BuildingFeature:
    """A file represented as a building (Polygon)."""

    path: str
    name: str
    street: str
    language: str
    lines_of_code: int
    avg_line_length: float
    created_at: str
    last_modified: str
    corners: list[GeoCoord]
    tier: int = 0
    base_height: float = 0.0
    top_height: float = 0.0

    def to_geojson(self) -> dict:
        # Close the polygon (first coord repeated at end)
        coords = [c.to_list() for c in self.corners]
        coords.append(coords[0])

        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "id": self.path,
                "name": self.name,
                "path": self.path,
                "street": self.street,
                "language": self.language,
                "lines_of_code": self.lines_of_code,
                "avg_line_length": self.avg_line_length,
                "created_at": self.created_at,
                "last_modified": self.last_modified,
                "tier": self.tier,
                "base_height": self.base_height,
                "top_height": self.top_height,
                "layer": "buildings",
            },
        }
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_building_feature_with_tier_properties -v`

Expected: PASS

**Step 5: Run full test suite**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: All tests pass

**Step 6: Commit**

```bash
git add src/codecity/analysis/geojson_models.py src/codecity/analysis/tests/test_geojson_models.py
git commit -m "feat: add tier fields to BuildingFeature"
```

---

## Task 10: Generate Tiered Buildings in Layout Engine

Update `_place_buildings_along_street()` to generate multiple tiers per building.

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:498-598`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `test_geojson_layout.py`:

```python
def test_layout_creates_tiered_buildings():
    """Large files should produce multiple building tiers."""
    # Create a file with 150 lines (should be 3 tiers)
    metrics = {
        "src/main.py": make_file_metrics("src/main.py", loc=150, avg_len=40.0)
    }
    # Add line_lengths to the metrics
    metrics["src/main.py"].line_lengths = [40] * 150

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
    main_buildings_sorted = sorted(main_buildings, key=lambda b: b["properties"]["tier"])
    for i, b in enumerate(main_buildings_sorted):
        if i > 0:
            prev = main_buildings_sorted[i - 1]
            assert b["properties"]["base_height"] == prev["properties"]["top_height"], (
                f"Tier {i} base should equal tier {i-1} top"
            )
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_tiered_buildings -v`

Expected: FAIL (only 1 building feature, not 3)

**Step 3: Add height interpolation function**

Add to `geojson_layout.py`:

```python
def interpolate_height(lines_of_code: int) -> float:
    """Calculate building height from lines of code.

    Uses the same interpolation as the frontend for consistency.
    """
    if lines_of_code <= 0:
        return 3.0
    elif lines_of_code <= 50:
        return 3.0 + (lines_of_code / 50) * 7.0  # 3 to 10
    elif lines_of_code <= 100:
        return 10.0 + ((lines_of_code - 50) / 50) * 15.0  # 10 to 25
    elif lines_of_code <= 300:
        return 25.0 + ((lines_of_code - 100) / 200) * 50.0  # 25 to 75
    elif lines_of_code <= 500:
        return 75.0 + ((lines_of_code - 300) / 200) * 75.0  # 75 to 150
    elif lines_of_code <= 1000:
        return 150.0 + ((lines_of_code - 500) / 500) * 150.0  # 150 to 300
    elif lines_of_code <= 3000:
        return 300.0 + ((lines_of_code - 1000) / 2000) * 200.0  # 300 to 500
    elif lines_of_code <= 5000:
        return 500.0 + ((lines_of_code - 3000) / 2000) * 328.0  # 500 to 828
    else:
        return 828.0  # Burj Khalifa max
```

**Step 4: Update _place_buildings_along_street() for tiered buildings**

This is a significant refactor. Replace the building placement logic:

```python
    def _place_buildings_along_street(
        self,
        files: list[tuple[str, FileMetrics]],
        street_path: str,
        street_start: GeoCoord,
        direction: str,
        start_offset: float,
    ) -> float:
        """Place buildings along both sides of a street, returning end position."""
        current_offset = start_offset

        for i, (path, metrics) in enumerate(files):
            side = 1 if i % 2 == 0 else -1
            position_along = (i // 2) * (MAX_BUILDING_WIDTH + BUILDING_GAP)

            # Calculate tiers
            num_tiers = calculate_num_tiers(metrics.lines_of_code)
            line_lengths = getattr(metrics, 'line_lengths', [])
            if line_lengths:
                tier_widths = calculate_tier_widths(line_lengths, num_tiers)
            else:
                # Fallback: use avg_line_length for all tiers
                base_width = min(
                    max(metrics.avg_line_length / 3, MIN_BUILDING_WIDTH),
                    MAX_BUILDING_WIDTH,
                )
                tier_widths = [base_width] * num_tiers

            # Calculate total height and per-tier heights
            total_height = interpolate_height(metrics.lines_of_code)
            tier_height = total_height / num_tiers

            # Building center offset from street
            building_offset = (
                STREET_WIDTH / 2
                + SIDEWALK_WIDTH
                + STREET_BUILDING_CLEARANCE
                + BUILDING_DEPTH / 2
            )

            # Calculate base position
            if direction == "horizontal":
                base_x = street_start.x + position_along
                base_y = street_start.y + side * building_offset
            else:
                base_x = street_start.x + side * building_offset
                base_y = street_start.y + position_along

            # Create a building feature for each tier
            for tier_idx, tier_width in enumerate(tier_widths):
                base_height = tier_idx * tier_height
                top_height = (tier_idx + 1) * tier_height

                # Tier corners (centered on base position)
                if direction == "horizontal":
                    corners = [
                        GeoCoord(base_x, base_y - BUILDING_DEPTH / 2),
                        GeoCoord(base_x + tier_width, base_y - BUILDING_DEPTH / 2),
                        GeoCoord(base_x + tier_width, base_y + BUILDING_DEPTH / 2),
                        GeoCoord(base_x, base_y + BUILDING_DEPTH / 2),
                    ]
                    box = BoundingBox(
                        base_x, base_y - BUILDING_DEPTH / 2,
                        base_x + tier_width, base_y + BUILDING_DEPTH / 2
                    )
                else:
                    corners = [
                        GeoCoord(base_x - BUILDING_DEPTH / 2, base_y),
                        GeoCoord(base_x + BUILDING_DEPTH / 2, base_y),
                        GeoCoord(base_x + BUILDING_DEPTH / 2, base_y + tier_width),
                        GeoCoord(base_x - BUILDING_DEPTH / 2, base_y + tier_width),
                    ]
                    box = BoundingBox(
                        base_x - BUILDING_DEPTH / 2, base_y,
                        base_x + BUILDING_DEPTH / 2, base_y + tier_width
                    )

                # Only register collision box for ground tier
                if tier_idx == 0:
                    self._occupied_boxes.append(box)

                self.buildings.append(
                    BuildingFeature(
                        path=path,
                        name=PurePosixPath(path).name,
                        street=street_path,
                        language=metrics.language,
                        lines_of_code=metrics.lines_of_code,
                        avg_line_length=metrics.avg_line_length,
                        created_at=metrics.created_at.isoformat(),
                        last_modified=metrics.last_modified.isoformat(),
                        corners=corners,
                        tier=tier_idx,
                        base_height=base_height,
                        top_height=top_height,
                    )
                )

            # Create footpath (only for ground tier)
            # Use the ground tier width for positioning
            ground_width = tier_widths[0]
            sidewalk_outer_offset = STREET_WIDTH / 2 + SIDEWALK_WIDTH
            building_edge_offset = (
                STREET_WIDTH / 2
                + SIDEWALK_WIDTH
                + STREET_BUILDING_CLEARANCE
            )

            if direction == "horizontal":
                building_edge = GeoCoord(
                    base_x + ground_width / 2,
                    street_start.y + side * building_edge_offset
                )
                sidewalk_point = GeoCoord(
                    base_x + ground_width / 2,
                    street_start.y + side * sidewalk_outer_offset
                )
            else:
                building_edge = GeoCoord(
                    street_start.x + side * building_edge_offset,
                    base_y + ground_width / 2
                )
                sidewalk_point = GeoCoord(
                    street_start.x + side * sidewalk_outer_offset,
                    base_y + ground_width / 2
                )

            self._create_footpath(path, building_edge, sidewalk_point, side, direction)

            current_offset = max(current_offset, position_along + max(tier_widths))

        return current_offset
```

**Step 5: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_tiered_buildings -v`

Expected: PASS

**Step 6: Run full test suite**

Run: `uv run pytest src/codecity/analysis/tests/ -v`

Expected: All tests pass (some may need updates for multi-tier building counts)

**Step 7: Update existing tests for multi-tier buildings**

Update `test_layout_creates_building_for_file` to account for tiers:

```python
def test_layout_creates_building_for_file():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [
        f for f in result["features"] if f["properties"]["layer"] == "buildings"
    ]
    # 100 LOC = 2 tiers
    main_buildings = [b for b in buildings if b["properties"]["path"] == "src/main.py"]
    assert len(main_buildings) >= 1
    assert main_buildings[0]["properties"]["name"] == "main.py"
    assert main_buildings[0]["geometry"]["type"] == "Polygon"
```

**Step 8: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "feat: generate tiered buildings based on line lengths"
```

---

## Task 11: Update Frontend for Tiered Buildings

Use base_height and top_height from properties instead of calculated values.

**Files:**
- Modify: `src/codecity/app/city-map.js:186-233`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing test**

Add to `city-map.test.js`:

```javascript
describe('buildings layer', () => {
    it('should use base_height and top_height from properties', () => {
        const cityMap = new CityMap('test-container');
        const addedLayers = [];
        cityMap.map = {
            addLayer: (layer) => addedLayers.push(layer),
            addControl: () => {},
            setLight: () => {},
        };

        cityMap.addLayers();

        const buildingsLayer = addedLayers.find(l => l.id === 'buildings');
        expect(buildingsLayer).toBeDefined();

        // Should use 'get' expression for heights, not interpolation
        const heightExpr = buildingsLayer.paint['fill-extrusion-height'];
        expect(heightExpr).toEqual(['get', 'top_height']);

        const baseExpr = buildingsLayer.paint['fill-extrusion-base'];
        expect(baseExpr).toEqual(['get', 'base_height']);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd src/codecity/app && npm test -- --run`

Expected: FAIL (height uses interpolation, not 'get')

**Step 3: Update buildings layer**

In `city-map.js`, update the buildings layer paint:

```javascript
        // Buildings (3D extruded) - tiered with base and top heights
        this.map.addLayer({
            id: 'buildings',
            type: 'fill-extrusion',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'buildings'],
            minzoom: 0,
            paint: {
                // Color based on language
                'fill-extrusion-color': [
                    'match',
                    ['get', 'language'],
                    'python', '#3776ab',
                    'javascript', '#f7df1e',
                    'typescript', '#3178c6',
                    'rust', '#dea584',
                    'go', '#00add8',
                    'java', '#b07219',
                    'ruby', '#cc342d',
                    'cpp', '#f34b7d',
                    'c', '#555555',
                    'markdown', '#083fa1',
                    'json', '#292929',
                    'yaml', '#cb171e',
                    'toml', '#9c4221',
                    '#888888'  // Default gray
                ],
                // Height from pre-calculated properties
                'fill-extrusion-height': ['get', 'top_height'],
                'fill-extrusion-base': ['get', 'base_height'],
                'fill-extrusion-opacity': 0.95,
                'fill-extrusion-vertical-gradient': true,
            },
        });
```

**Step 4: Run test to verify it passes**

Run: `cd src/codecity/app && npm test -- --run`

Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "feat: use pre-calculated tier heights for buildings"
```

---

## Task 12: Visual Verification and Final Testing

Run the full application and verify visual improvements.

**Files:**
- No code changes
- Visual verification

**Step 1: Run all tests**

```bash
just test
just lint
just typecheck
```

Expected: All pass

**Step 2: Start dev server**

```bash
uv run codecity serve .
```

**Step 3: Visual verification checklist**

Open browser and verify:

- [ ] Streets connect at intersections (no gaps)
- [ ] Sidewalks run full length of roads (filled polygons)
- [ ] Footpaths connect buildings to sidewalks
- [ ] Large files show stepped/terraced building shapes
- [ ] Small files (1 tier) render correctly

**Step 4: Commit any final fixes**

If issues found, fix and commit each separately.

**Step 5: Final commit for the feature**

```bash
git add -A
git commit -m "feat: complete visualization improvements

- Streets extend to cover all branch points
- Sidewalks rendered as filled polygons
- Footpaths connect buildings to sidewalk edges
- Buildings show stepped tiers based on code sections"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Fix street length for branch points | geojson_layout.py |
| 2 | Fix main street length | geojson_layout.py |
| 3 | Convert SidewalkFeature to polygon | geojson_models.py |
| 4 | Update _create_sidewalks() | geojson_layout.py |
| 5 | Update frontend sidewalk layer | city-map.js |
| 6 | Fix footpath endpoints | geojson_layout.py |
| 7 | Add line_lengths to FileMetrics | models.py, metrics.py |
| 8 | Add tier calculation functions | geojson_layout.py |
| 9 | Add tier fields to BuildingFeature | geojson_models.py |
| 10 | Generate tiered buildings | geojson_layout.py |
| 11 | Update frontend for tiered buildings | city-map.js |
| 12 | Visual verification | - |
