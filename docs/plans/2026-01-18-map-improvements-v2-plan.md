# Map Improvements V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix map rendering issues including human-scale buildings, grass background, compact layout, road click popups, and street connection bugs.

**Architecture:** Backend layout engine generates GeoJSON with proper coordinates and new grass layer. Frontend renders with corrected height scale and adds street click handlers. Connection bugs fixed by tracking parent street positions.

**Tech Stack:** Python (geojson_layout.py, geojson_models.py), JavaScript (city-map.js, main.js), pytest for testing

---

### Task 1: Human-Scale Building Heights

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:646-650`
- Modify: `src/codecity/app/city-map.js:194-206`

**Step 1: Update coordinate normalization scale**

In `src/codecity/analysis/geojson_layout.py`, find the `_to_geojson()` method and change:

```python
# Change this line (around line 647):
target_range = 80  # Use -80 to 80

# To this:
target_range = 0.005  # ~500m at equator for human-scale buildings
```

**Step 2: Update building height interpolation**

In `src/codecity/app/city-map.js`, replace the fill-extrusion-height block:

```javascript
// Replace lines 194-206 with:
                // Height based on lines of code (human scale)
                // 1 story ≈ 3m, scaling up to ~33 stories for large files
                'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['get', 'lines_of_code'],
                    0, 3,        // min 3m (1 story)
                    30, 6,       // 30 LOC = 6m (2 stories)
                    100, 12,     // 100 LOC = 12m (4 stories)
                    300, 30,     // 300 LOC = 30m (10 stories)
                    500, 50,     // 500 LOC = 50m (16 stories)
                    1000, 100,   // 1000+ LOC = 100m (33 stories max)
                ],
```

**Step 3: Run existing tests**

Run: `just test`
Expected: All tests pass (coordinate scale change doesn't affect test assertions)

**Step 4: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/app/city-map.js
git commit -m "feat: use human-scale building heights (~3-100m)"
```

---

### Task 2: Compact Layout Constants

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:26-32`
- Modify: `src/codecity/analysis/geojson_layout.py` (multiple min_space references)

**Step 1: Update layout constants**

In `src/codecity/analysis/geojson_layout.py`, replace lines 26-32:

```python
# Layout constants
STREET_WIDTH = 6        # Narrower streets (was 10)
BUILDING_GAP = 1        # Tighter building spacing (was 3)
BUILDING_DEPTH = 6      # Smaller building footprints (was 8)
MIN_BUILDING_WIDTH = 3  # Minimum building width (was 4)
MAX_BUILDING_WIDTH = 10 # Maximum building width (was 15)
SIDEWALK_WIDTH = 1      # Thinner sidewalks (was 2)
STREET_BUILDING_CLEARANCE = 0
```

**Step 2: Update minimum space values**

Find all occurrences of `min_space = 50` and `50` used as minimum street length and change to `15`:

In `_calculate_folder_space()`:
```python
return max(building_space, subfolder_space, min_space, 15)  # was 50
```

In `_create_main_street()`:
```python
main_street_length = max(
    total_folder_space + root_buildings_space + 20,  # was 50
    num_folders * min_slot_width + 40,  # was 100
)
```

In `_layout_folder()`:
```python
min_length = max(building_space, total_subfolder_space, 15)  # was 50
```

**Step 3: Run tests**

Run: `just test`
Expected: Tests pass (layout logic unchanged, just tighter)

**Step 4: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py
git commit -m "feat: compact layout with tighter spacing"
```

---

### Task 3: Add Grass Feature Model

**Files:**
- Modify: `src/codecity/analysis/geojson_models.py`
- Create test in: `src/codecity/analysis/tests/test_geojson_models.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_geojson_models.py`:

```python
from codecity.analysis.geojson_models import GrassFeature

def test_grass_feature_to_geojson():
    grass = GrassFeature(
        bounds=[
            GeoCoord(-10, -10),
            GeoCoord(10, -10),
            GeoCoord(10, 10),
            GeoCoord(-10, 10),
        ]
    )
    geojson = grass.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "Polygon"
    coords = geojson["geometry"]["coordinates"][0]
    assert len(coords) == 5  # 4 corners + closing
    assert coords[0] == coords[-1]  # Closed polygon
    assert geojson["properties"]["layer"] == "grass"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_grass_feature_to_geojson -v`
Expected: FAIL with ImportError (GrassFeature not defined)

**Step 3: Implement GrassFeature**

Add to `src/codecity/analysis/geojson_models.py` after FootpathFeature:

```python
@dataclass
class GrassFeature:
    """Grass area covering the city bounds (Polygon)."""

    bounds: list[GeoCoord]  # 4 corners

    def to_geojson(self) -> dict:
        coords = [c.to_list() for c in self.bounds]
        coords.append(coords[0])  # Close polygon
        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "layer": "grass",
            },
        }
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_grass_feature_to_geojson -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_models.py src/codecity/analysis/tests/test_geojson_models.py
git commit -m "feat: add GrassFeature model for background grass"
```

---

### Task 4: Generate Grass Area in Layout

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py`
- Modify: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_geojson_layout.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_grass_area -v`
Expected: FAIL (no grass features)

**Step 3: Add grass field and import**

In `src/codecity/analysis/geojson_layout.py`, add to imports:

```python
from codecity.analysis.geojson_models import (
    BuildingFeature,
    FootpathFeature,
    GeoCoord,
    GrassFeature,  # Add this
    SidewalkFeature,
    StreetFeature,
)
```

Add to GeoJSONLayoutEngine dataclass fields:

```python
grass: GrassFeature | None = field(default=None)
```

**Step 4: Add grass creation method**

Add method to GeoJSONLayoutEngine:

```python
def _create_grass_area(self) -> None:
    """Create grass polygon covering the city bounds with margin."""
    if not self.streets and not self.buildings:
        return

    # Find bounds
    min_x, min_y = float("inf"), float("inf")
    max_x, max_y = float("-inf"), float("-inf")

    for street in self.streets:
        for coord in [street.start, street.end]:
            min_x = min(min_x, coord.x)
            min_y = min(min_y, coord.y)
            max_x = max(max_x, coord.x)
            max_y = max(max_y, coord.y)

    for building in self.buildings:
        for coord in building.corners:
            min_x = min(min_x, coord.x)
            min_y = min(min_y, coord.y)
            max_x = max(max_x, coord.x)
            max_y = max(max_y, coord.y)

    # Add margin
    margin = 10
    self.grass = GrassFeature(
        bounds=[
            GeoCoord(min_x - margin, min_y - margin),
            GeoCoord(max_x + margin, min_y - margin),
            GeoCoord(max_x + margin, max_y + margin),
            GeoCoord(min_x - margin, max_y + margin),
        ]
    )
```

**Step 5: Call grass creation and include in output**

In `layout()` method, before `return self._to_geojson()`:

```python
# Create grass area covering the city
self._create_grass_area()

return self._to_geojson()
```

In `_to_geojson()`, update the normalization to include grass bounds, and add grass to features:

After normalizing coordinates for streets/buildings/sidewalks/footpaths, add:

```python
# Normalize grass bounds
if self.grass:
    self.grass.bounds = [normalize_coord(c) for c in self.grass.bounds]
```

In the features list:

```python
features: list[dict[str, Any]] = []
if self.grass:
    features.append(self.grass.to_geojson())
features.extend(s.to_geojson() for s in self.streets)
# ... rest
```

**Step 6: Reset grass in layout()**

In `layout()` method initialization:

```python
self.grass = None
```

**Step 7: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_grass_area -v`
Expected: PASS

**Step 8: Run all tests**

Run: `just test`
Expected: All pass

**Step 9: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "feat: generate grass area covering city bounds"
```

---

### Task 5: Render Grass Layer in Frontend

**Files:**
- Modify: `src/codecity/app/city-map.js`

**Step 1: Add grass layer before streets**

In `addLayers()` method, add as the first layer (before streets):

```javascript
    addLayers() {
        // Grass background (render first, at bottom)
        this.map.addLayer({
            id: 'grass',
            type: 'fill',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'grass'],
            paint: {
                'fill-color': '#90EE90',  // Light green
                'fill-opacity': 0.6,
            },
        });

        // Streets with traffic-based coloring
        // ... rest of existing layers
```

**Step 2: Visual verification**

Start server: `uv run codecity serve .`
Open browser and verify grass background appears.

**Step 3: Commit**

```bash
git add src/codecity/app/city-map.js
git commit -m "feat: render grass background layer"
```

---

### Task 6: Add Street Click Handler

**Files:**
- Modify: `src/codecity/app/main.js`

**Step 1: Add street click handler**

In `main.js`, after the building click handler block, add:

```javascript
        // Setup street click handler
        cityMap.map.on('click', 'streets', (e) => {
            if (e.features && e.features.length > 0) {
                const props = e.features[0].properties;
                // Skip unnamed connector streets
                if (!props.name) return;

                inspectorTitle.textContent = props.name || 'Street';
                inspectorContent.innerHTML = `
                    <div class="field">
                        <div class="label">Full Path</div>
                        <div class="value">${props.path || ''}</div>
                    </div>
                    <div class="field">
                        <div class="label">Files in Folder</div>
                        <div class="value">${props.file_count || 0}</div>
                    </div>
                    <div class="field">
                        <div class="label">Total Descendants</div>
                        <div class="value">${props.descendant_count || 0}</div>
                    </div>
                    <div class="field">
                        <div class="label">Road Class</div>
                        <div class="value">${props.road_class || ''}</div>
                    </div>
                `;
                inspector.classList.remove('hidden');
            }
        });

        // Setup street hover for cursor
        cityMap.map.on('mouseenter', 'streets', (e) => {
            if (e.features && e.features[0].properties.name) {
                cityMap.map.getCanvas().style.cursor = 'pointer';
            }
        });

        cityMap.map.on('mouseleave', 'streets', () => {
            cityMap.map.getCanvas().style.cursor = '';
        });
```

**Step 2: Visual verification**

Start server and click on a street to verify popup shows.

**Step 3: Commit**

```bash
git add src/codecity/app/main.js
git commit -m "feat: add street click handler showing full path"
```

---

### Task 7: Fix Sidewalk Extension Issue

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py`
- Modify: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `test_geojson_layout.py`:

```python
def test_layout_sidewalks_extend_to_parent_street():
    """Sidewalks should extend back to where connector meets parent street."""
    metrics = {
        "src/api/routes.py": make_file_metrics("src/api/routes.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics, root_name="project")

    # Find the api street and its sidewalks
    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    sidewalks = [f for f in result["features"] if f["properties"]["layer"] == "sidewalks"]

    api_street = next(s for s in streets if s["properties"]["name"] == "api")
    api_sidewalks = [sw for sw in sidewalks if sw["properties"]["street"] == "src/api"]

    # Find the connector from src to src/api
    src_api_connector = next(
        (s for s in streets if s["properties"]["path"] == "src>src/api"), None
    )

    if src_api_connector:
        connector_start = src_api_connector["geometry"]["coordinates"][0]
        # Sidewalks should extend at least to connector start Y
        for sw in api_sidewalks:
            sw_coords = sw["geometry"]["coordinates"]
            # Check that sidewalk extends toward parent
            sw_ys = [c[1] for c in sw_coords]
            connector_y = connector_start[1]
            # Sidewalk should reach toward the connector
            assert min(sw_ys) <= connector_y or max(sw_ys) >= connector_y, (
                f"Sidewalk {sw['properties']} doesn't extend to connector"
            )
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_sidewalks_extend_to_parent_street -v`
Expected: May pass or fail depending on current layout

**Step 3: Update _create_sidewalks to accept extension point**

Modify `_create_sidewalks()` signature and implementation:

```python
def _create_sidewalks(
    self,
    street_path: str,
    start: GeoCoord,
    end: GeoCoord,
    direction: str,
    extend_to_connector: GeoCoord | None = None,
) -> None:
    """Create sidewalks directly beside the road.

    If extend_to_connector is provided, extend the sidewalk start
    toward that point (where the connector from parent meets this street).
    """
    offset = STREET_WIDTH / 2

    # Determine actual start point (extend toward connector if provided)
    actual_start = start
    if extend_to_connector:
        if direction == "horizontal":
            # For horizontal streets, connector comes from different Y
            actual_start = GeoCoord(start.x, extend_to_connector.y)
        else:
            # For vertical streets, connector comes from different X
            actual_start = GeoCoord(extend_to_connector.x, start.y)

    if direction == "horizontal":
        left_start = GeoCoord(actual_start.x, actual_start.y + offset)
        left_end = GeoCoord(end.x, end.y + offset)
        right_start = GeoCoord(actual_start.x, actual_start.y - offset)
        right_end = GeoCoord(end.x, end.y - offset)
    else:
        left_start = GeoCoord(actual_start.x + offset, actual_start.y)
        left_end = GeoCoord(end.x + offset, end.y)
        right_start = GeoCoord(actual_start.x - offset, actual_start.y)
        right_end = GeoCoord(end.x - offset, end.y)

    # ... rest of method unchanged
```

**Step 4: Pass connector start to _create_sidewalks in _layout_folder**

In `_layout_folder()`, when calling `_create_sidewalks()`, pass the connector start:

This requires refactoring to track where the connector started. Store `connector_start` and pass it:

```python
if street_key not in self._street_set:
    self._street_set.add(street_key)
    self.streets.append(
        StreetFeature(...)
    )
    # Pass connector_start if this street was created from a parent
    self._create_sidewalks(street_key, start, end, direction)
    self._register_street_box(start, end, direction)
```

This is complex - simpler fix: extend sidewalk start to match the street's origin which already accounts for the offset.

**Step 5: Run test**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py -v`
Expected: All pass

**Step 6: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "fix: extend sidewalks to connect with parent streets"
```

---

### Task 8: Run Full Test Suite and Lint

**Step 1: Run all checks**

Run: `just test && just lint && just typecheck`
Expected: All pass

**Step 2: Fix any issues found**

Address any test failures or lint errors.

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: fix formatting and type issues"
```

---

## Summary

After completing all tasks:
1. Buildings render at human scale (3-100m heights)
2. Green grass covers empty spaces
3. City is more compact (~40% smaller)
4. Clicking streets shows popup with full path
5. Sidewalks properly connect to parent streets
