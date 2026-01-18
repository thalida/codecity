# Map Rendering Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the MapLibre city visualization with street labels, 3D buildings, sidewalks, footpaths, and fix overlap/tiling issues.

**Architecture:** Backend generates new GeoJSON feature types (sidewalks, footpaths) in the layout engine. Frontend adds new MapLibre layers for labels, 3D extrusion, sidewalks, and footpaths. Layout algorithm spacing increased to prevent overlaps.

**Tech Stack:** Python (layout engine, models), JavaScript (MapLibre GL JS), pytest (Python tests), Vitest (JS tests)

---

## Task 1: Disable Map Tiling (renderWorldCopies)

**Files:**
- Modify: `src/codecity/app/city-map.js:22-30`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing test**

Add to `src/codecity/app/__tests__/city-map.test.js`:

```javascript
describe('init', () => {
    it('creates map with renderWorldCopies disabled', async () => {
        const cityMap = new CityMap(mockContainer);
        await cityMap.init('/api/city.geojson');

        // Check that Map was created with renderWorldCopies: false
        const mapCall = maplibregl.Map.mock.calls[0][0];
        expect(mapCall.renderWorldCopies).toBe(false);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: FAIL (renderWorldCopies not set)

**Step 3: Add renderWorldCopies option**

In `src/codecity/app/city-map.js`, modify the Map constructor (lines 22-30):

```javascript
this.map = new maplibregl.Map({
    container: this.container,
    style: `/styles/${this.theme}.json`,
    bounds: bounds,
    fitBoundsOptions: { padding: 50 },
    pitch: 45,
    bearing: -15,
    antialias: true,
    renderWorldCopies: false,
});
```

**Step 4: Run test to verify it passes**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "fix: disable map tiling when zooming out (renderWorldCopies: false)"
```

---

## Task 2: Add Street Labels Layer

**Files:**
- Modify: `src/codecity/app/city-map.js:72-100`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing test**

Add to `src/codecity/app/__tests__/city-map.test.js`:

```javascript
describe('addLayers', () => {
    it('adds street-labels symbol layer', async () => {
        const cityMap = new CityMap(mockContainer);
        await cityMap.init('/api/city.geojson');

        const addLayerCalls = cityMap.map.addLayer.mock.calls;
        const labelLayer = addLayerCalls.find(call => call[0].id === 'street-labels');

        expect(labelLayer).toBeDefined();
        expect(labelLayer[0].type).toBe('symbol');
        expect(labelLayer[0].layout['symbol-placement']).toBe('line');
        expect(labelLayer[0].layout['text-field']).toEqual(['get', 'name']);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: FAIL (street-labels layer not found)

**Step 3: Add street-labels layer**

In `src/codecity/app/city-map.js`, add after the streets layer in `addLayers()`:

```javascript
// Street labels
this.map.addLayer({
    id: 'street-labels',
    type: 'symbol',
    source: 'city',
    filter: ['==', ['get', 'layer'], 'streets'],
    layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': [
            'match',
            ['get', 'road_class'],
            'primary', 14,
            'secondary', 12,
            10
        ],
        'text-anchor': 'center',
        'text-max-angle': 30,
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 2,
    },
});
```

**Step 4: Run test to verify it passes**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "feat: add street labels that follow road direction"
```

---

## Task 3: Fix Building Overlap - Increase Subfolder Offset

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py:12-18, 117`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_geojson_layout.py`:

```python
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
        return not (max_x1 < min_x2 or max_x2 < min_x1 or max_y1 < min_y2 or max_y2 < min_y1)

    # Check no buildings overlap
    for i, b1 in enumerate(buildings):
        for b2 in buildings[i + 1:]:
            assert not boxes_overlap(b1, b2), (
                f"Buildings overlap: {b1['properties']['name']} and {b2['properties']['name']}"
            )
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_subfolders_do_not_overlap_parent_buildings -v`
Expected: FAIL (buildings overlap)

**Step 3: Increase subfolder offset**

In `src/codecity/analysis/geojson_layout.py`:

1. Update constants (around line 17):
```python
SUBFOLDER_OFFSET = STREET_WIDTH + BUILDING_DEPTH + BUILDING_GAP + STREET_WIDTH // 2  # ~25
```

2. Update `_layout_folder()` (line 117):
```python
subfolder_offset = SUBFOLDER_OFFSET
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_subfolders_do_not_overlap_parent_buildings -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "fix: increase subfolder offset to prevent building overlap"
```

---

## Task 4: Convert Buildings to 3D Extrusion

**Files:**
- Modify: `src/codecity/app/city-map.js:89-99`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing test**

Add to `src/codecity/app/__tests__/city-map.test.js`:

```javascript
it('adds buildings as fill-extrusion layer with height from lines_of_code', async () => {
    const cityMap = new CityMap(mockContainer);
    await cityMap.init('/api/city.geojson');

    const addLayerCalls = cityMap.map.addLayer.mock.calls;
    const buildingLayer = addLayerCalls.find(call => call[0].id === 'buildings');

    expect(buildingLayer).toBeDefined();
    expect(buildingLayer[0].type).toBe('fill-extrusion');
    expect(buildingLayer[0].paint['fill-extrusion-height']).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: FAIL (type is 'fill' not 'fill-extrusion')

**Step 3: Convert buildings to fill-extrusion**

In `src/codecity/app/city-map.js`, replace the buildings layer:

```javascript
// Buildings (3D extruded)
this.map.addLayer({
    id: 'buildings',
    type: 'fill-extrusion',
    source: 'city',
    filter: ['==', ['get', 'layer'], 'buildings'],
    paint: {
        'fill-extrusion-color': '#888888',
        'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['get', 'lines_of_code'],
            0, 5,      // min height 5
            100, 15,   // 100 LOC = 15 height
            500, 50,   // 500 LOC = 50 height
            1000, 80,  // 1000+ LOC = max 80 height
        ],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.9,
    },
});
```

**Step 4: Run test to verify it passes**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "feat: render buildings as 3D extrusions based on lines of code"
```

---

## Task 5: Add SidewalkFeature Model

**Files:**
- Create: `src/codecity/analysis/geojson_models.py` (add class)
- Test: `src/codecity/analysis/tests/test_geojson_models.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_geojson_models.py`:

```python
from codecity.analysis.geojson_models import SidewalkFeature


def test_sidewalk_feature_to_geojson():
    sidewalk = SidewalkFeature(
        street_path="src",
        side="left",
        start=GeoCoord(0, 6),
        end=GeoCoord(100, 6),
    )
    geojson = sidewalk.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "LineString"
    assert geojson["geometry"]["coordinates"] == [[0, 6], [100, 6]]
    assert geojson["properties"]["layer"] == "sidewalks"
    assert geojson["properties"]["street"] == "src"
    assert geojson["properties"]["side"] == "left"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_sidewalk_feature_to_geojson -v`
Expected: FAIL (ImportError: cannot import SidewalkFeature)

**Step 3: Add SidewalkFeature class**

Add to `src/codecity/analysis/geojson_models.py`:

```python
@dataclass
class SidewalkFeature:
    """A sidewalk running parallel to a street (LineString)."""

    street_path: str
    side: str  # "left" or "right"
    start: GeoCoord
    end: GeoCoord

    def to_geojson(self) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [self.start.to_list(), self.end.to_list()],
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
git commit -m "feat: add SidewalkFeature model for parallel sidewalks"
```

---

## Task 6: Add FootpathFeature Model

**Files:**
- Modify: `src/codecity/analysis/geojson_models.py`
- Test: `src/codecity/analysis/tests/test_geojson_models.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_geojson_models.py`:

```python
from codecity.analysis.geojson_models import FootpathFeature


def test_footpath_feature_to_geojson():
    footpath = FootpathFeature(
        building_path="src/main.py",
        points=[
            GeoCoord(15, 9),   # building edge
            GeoCoord(14, 7),   # curve control
            GeoCoord(12, 6),   # sidewalk
        ],
    )
    geojson = footpath.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "LineString"
    assert len(geojson["geometry"]["coordinates"]) == 3
    assert geojson["properties"]["layer"] == "footpaths"
    assert geojson["properties"]["building"] == "src/main.py"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_footpath_feature_to_geojson -v`
Expected: FAIL (ImportError: cannot import FootpathFeature)

**Step 3: Add FootpathFeature class**

Add to `src/codecity/analysis/geojson_models.py`:

```python
@dataclass
class FootpathFeature:
    """A curved footpath connecting a building to the sidewalk (LineString)."""

    building_path: str
    points: list[GeoCoord]  # Start at building, curve to sidewalk

    def to_geojson(self) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [p.to_list() for p in self.points],
            },
            "properties": {
                "building": self.building_path,
                "layer": "footpaths",
            },
        }
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py::test_footpath_feature_to_geojson -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_models.py src/codecity/analysis/tests/test_geojson_models.py
git commit -m "feat: add FootpathFeature model for curved building paths"
```

---

## Task 7: Generate Sidewalks in Layout Engine

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_geojson_layout.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_sidewalks_for_streets -v`
Expected: FAIL (no sidewalks in result)

**Step 3: Generate sidewalks in layout engine**

In `src/codecity/analysis/geojson_layout.py`:

1. Add import:
```python
from codecity.analysis.geojson_models import BuildingFeature, GeoCoord, StreetFeature, SidewalkFeature
```

2. Add constant after existing constants:
```python
SIDEWALK_OFFSET = 1  # Distance from street edge to sidewalk
```

3. Add `sidewalks` field to `GeoJSONLayoutEngine`:
```python
sidewalks: list[SidewalkFeature] = field(default_factory=list)
```

4. Reset sidewalks in `layout()`:
```python
self.sidewalks = []
```

5. Add method to create sidewalks (after `_place_buildings`):
```python
def _create_sidewalks(
    self,
    street_path: str,
    start: GeoCoord,
    end: GeoCoord,
    direction: str,
) -> None:
    """Create sidewalks on both sides of a street."""
    offset = STREET_WIDTH / 2 + SIDEWALK_OFFSET

    if direction == "horizontal":
        left_start = GeoCoord(start.x, start.y + offset)
        left_end = GeoCoord(end.x, end.y + offset)
        right_start = GeoCoord(start.x, start.y - offset)
        right_end = GeoCoord(end.x, end.y - offset)
    else:
        left_start = GeoCoord(start.x + offset, start.y)
        left_end = GeoCoord(end.x + offset, end.y)
        right_start = GeoCoord(start.x - offset, start.y)
        right_end = GeoCoord(end.x - offset, end.y)

    self.sidewalks.append(SidewalkFeature(
        street_path=street_path,
        side="left",
        start=left_start,
        end=left_end,
    ))
    self.sidewalks.append(SidewalkFeature(
        street_path=street_path,
        side="right",
        start=right_start,
        end=right_end,
    ))
```

6. Call `_create_sidewalks` in `_layout_folder()` after creating the street (around line 106):
```python
if street_key not in self._street_set and folder_path:
    self._street_set.add(street_key)
    self.streets.append(...)
    self._create_sidewalks(street_key, start, end, direction)
```

7. Include sidewalks in `_to_geojson()`:
```python
features.extend(s.to_geojson() for s in self.sidewalks)
```

8. Normalize sidewalk coordinates in `_to_geojson()`:
```python
for sidewalk in self.sidewalks:
    sidewalk.start = normalize_coord(sidewalk.start)
    sidewalk.end = normalize_coord(sidewalk.end)
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_sidewalks_for_streets -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "feat: generate sidewalks on both sides of streets"
```

---

## Task 8: Generate Curved Footpaths in Layout Engine

**Files:**
- Modify: `src/codecity/analysis/geojson_layout.py`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_geojson_layout.py`:

```python
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
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_footpath_for_each_building -v`
Expected: FAIL (no footpaths in result)

**Step 3: Generate footpaths in layout engine**

In `src/codecity/analysis/geojson_layout.py`:

1. Update import:
```python
from codecity.analysis.geojson_models import BuildingFeature, FootpathFeature, GeoCoord, SidewalkFeature, StreetFeature
```

2. Add `footpaths` field:
```python
footpaths: list[FootpathFeature] = field(default_factory=list)
```

3. Reset footpaths in `layout()`:
```python
self.footpaths = []
```

4. Add method to create curved footpath:
```python
def _create_footpath(
    self,
    building_path: str,
    building_center: GeoCoord,
    sidewalk_point: GeoCoord,
    side: int,
    direction: str,
) -> None:
    """Create a curved footpath from building to sidewalk."""
    # Calculate control point for gentle curve
    if direction == "horizontal":
        ctrl_x = (building_center.x + sidewalk_point.x) / 2
        ctrl_y = building_center.y - side * (abs(building_center.y - sidewalk_point.y) * 0.3)
    else:
        ctrl_x = building_center.x - side * (abs(building_center.x - sidewalk_point.x) * 0.3)
        ctrl_y = (building_center.y + sidewalk_point.y) / 2

    control = GeoCoord(ctrl_x, ctrl_y)

    # Generate curve points (quadratic bezier approximation)
    points = [building_center, control, sidewalk_point]

    self.footpaths.append(FootpathFeature(
        building_path=building_path,
        points=points,
    ))
```

5. Call `_create_footpath` in `_place_buildings()` after creating each building:
```python
# Calculate footpath connection point
if direction == "horizontal":
    building_edge = GeoCoord(x + width / 2, street_start.y + side * (STREET_WIDTH / 2 + SIDEWALK_OFFSET))
    sidewalk_y = street_start.y + side * (STREET_WIDTH / 2 + SIDEWALK_OFFSET)
    sidewalk_point = GeoCoord(x + width / 2, sidewalk_y)
else:
    building_edge = GeoCoord(street_start.x + side * (STREET_WIDTH / 2 + SIDEWALK_OFFSET), y + width / 2)
    sidewalk_x = street_start.x + side * (STREET_WIDTH / 2 + SIDEWALK_OFFSET)
    sidewalk_point = GeoCoord(sidewalk_x, y + width / 2)

# Get building center for footpath start
if direction == "horizontal":
    building_center = GeoCoord(x + width / 2, y)
else:
    building_center = GeoCoord(x, y + width / 2)

self._create_footpath(path, building_center, sidewalk_point, side, direction)
```

6. Include footpaths in `_to_geojson()`:
```python
features.extend(f.to_geojson() for f in self.footpaths)
```

7. Normalize footpath coordinates in `_to_geojson()`:
```python
for footpath in self.footpaths:
    footpath.points = [normalize_coord(p) for p in footpath.points]
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py::test_layout_creates_footpath_for_each_building -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "feat: generate curved footpaths from buildings to sidewalks"
```

---

## Task 9: Add Sidewalks Layer to Frontend

**Files:**
- Modify: `src/codecity/app/city-map.js`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing test**

Add to `src/codecity/app/__tests__/city-map.test.js`:

```javascript
it('adds sidewalks layer', async () => {
    const cityMap = new CityMap(mockContainer);
    await cityMap.init('/api/city.geojson');

    const addLayerCalls = cityMap.map.addLayer.mock.calls;
    const sidewalksLayer = addLayerCalls.find(call => call[0].id === 'sidewalks');

    expect(sidewalksLayer).toBeDefined();
    expect(sidewalksLayer[0].type).toBe('line');
    expect(sidewalksLayer[0].filter).toEqual(['==', ['get', 'layer'], 'sidewalks']);
});
```

**Step 2: Run test to verify it fails**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: FAIL (sidewalks layer not found)

**Step 3: Add sidewalks layer**

In `src/codecity/app/city-map.js`, add in `addLayers()` after streets layer:

```javascript
// Sidewalks
this.map.addLayer({
    id: 'sidewalks',
    type: 'line',
    source: 'city',
    filter: ['==', ['get', 'layer'], 'sidewalks'],
    paint: {
        'line-color': '#cccccc',
        'line-width': 2,
    },
    layout: {
        'line-cap': 'round',
        'line-join': 'round',
    },
});
```

**Step 4: Run test to verify it passes**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "feat: add sidewalks layer to map rendering"
```

---

## Task 10: Add Footpaths Layer to Frontend

**Files:**
- Modify: `src/codecity/app/city-map.js`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing test**

Add to `src/codecity/app/__tests__/city-map.test.js`:

```javascript
it('adds footpaths layer', async () => {
    const cityMap = new CityMap(mockContainer);
    await cityMap.init('/api/city.geojson');

    const addLayerCalls = cityMap.map.addLayer.mock.calls;
    const footpathsLayer = addLayerCalls.find(call => call[0].id === 'footpaths');

    expect(footpathsLayer).toBeDefined();
    expect(footpathsLayer[0].type).toBe('line');
    expect(footpathsLayer[0].filter).toEqual(['==', ['get', 'layer'], 'footpaths']);
});
```

**Step 2: Run test to verify it fails**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: FAIL (footpaths layer not found)

**Step 3: Add footpaths layer**

In `src/codecity/app/city-map.js`, add in `addLayers()` after sidewalks layer:

```javascript
// Footpaths (curved paths from buildings to sidewalks)
this.map.addLayer({
    id: 'footpaths',
    type: 'line',
    source: 'city',
    filter: ['==', ['get', 'layer'], 'footpaths'],
    paint: {
        'line-color': '#aaaaaa',
        'line-width': 1,
    },
    layout: {
        'line-cap': 'round',
        'line-join': 'round',
    },
});
```

**Step 4: Run test to verify it passes**

Run: `cd src/codecity/app && npm test -- --run city-map.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "feat: add footpaths layer to map rendering"
```

---

## Task 11: Run Full Test Suite and Fix Any Issues

**Files:**
- All modified files

**Step 1: Run Python tests**

Run: `uv run pytest src/codecity -v`
Expected: All tests PASS

**Step 2: Run JavaScript tests**

Run: `cd src/codecity/app && npm test`
Expected: All tests PASS

**Step 3: Run linting**

Run: `just lint`
Expected: No errors

**Step 4: Run type checking**

Run: `just typecheck`
Expected: No errors

**Step 5: Manual visual verification**

Run: `uv run codecity serve .`
Open browser and verify:
- Street labels visible and following road direction
- No building overlaps
- Map doesn't tile when zooming out
- Buildings render in 3D with varying heights
- Sidewalks visible along streets
- Footpaths connect buildings to sidewalks

**Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: fix any remaining issues from testing"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Disable map tiling | city-map.js |
| 2 | Add street labels | city-map.js |
| 3 | Fix building overlap | geojson_layout.py |
| 4 | 3D building extrusion | city-map.js |
| 5 | SidewalkFeature model | geojson_models.py |
| 6 | FootpathFeature model | geojson_models.py |
| 7 | Generate sidewalks | geojson_layout.py |
| 8 | Generate footpaths | geojson_layout.py |
| 9 | Sidewalks layer | city-map.js |
| 10 | Footpaths layer | city-map.js |
| 11 | Full test suite | All |
