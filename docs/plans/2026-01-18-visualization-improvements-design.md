# Visualization Improvements Design

## Overview

This document describes fixes and enhancements to the CodeCity visualization:

1. **Road connection fixes** - Streets visually connect at intersections
2. **Footpath connection fixes** - Building footpaths reach sidewalks
3. **Sidewalk length fixes** - Sidewalks run the full length of roads
4. **Sidewalks as filled polygons** - Rectangular strips with actual width
5. **Stepped/terraced buildings** - Width varies by height based on code metrics

## 1. Road Connection Fixes

### Problem

Child streets don't visually connect to parent streets. For example, `src/codecity/app/tests/` doesn't connect to the `app` road.

### Root Cause

In `_layout_folder()`, the street length is calculated based on building space and subfolder space, but the street endpoint doesn't always extend to cover all connector branch points.

### Solution

Ensure parent streets extend to cover all branch points:

```python
def _layout_folder(self, ...):
    # Calculate street length to cover:
    # 1. All buildings placed along this street
    # 2. All subfolder branch points

    # Current: street ends at max(building_space, total_subfolder_space)
    # Fixed: street ends at max(building_space, furthest_branch_point + margin)

    furthest_branch = 0
    for i, (subfolder_name, subfolder_space) in enumerate(subfolder_spaces):
        position_along = current_offset + subfolder_space / 2
        furthest_branch = max(furthest_branch, position_along)

    min_length = max(building_space, furthest_branch + BUILDING_GAP, 15)
```

### Files Changed

- `src/codecity/analysis/geojson_layout.py`

## 2. Footpath Connection Fixes

### Problem

Footpaths from buildings float in space - they don't reach the sidewalk.

### Root Cause

The footpath endpoint (`sidewalk_point`) is calculated at `STREET_WIDTH / 2`, but with polygon sidewalks the inner edge will be at `STREET_WIDTH / 2`. The footpath should connect to this edge precisely.

### Solution

Align footpath coordinates with sidewalk geometry:

```python
def _create_footpath(self, ...):
    # Footpath starts at building edge (closest to street)
    building_edge_offset = (
        STREET_WIDTH / 2
        + SIDEWALK_WIDTH
        + STREET_BUILDING_CLEARANCE
    )

    # Footpath ends at sidewalk outer edge (where buildings meet sidewalk)
    sidewalk_outer_edge = STREET_WIDTH / 2 + SIDEWALK_WIDTH

    # For polygon sidewalks, footpath connects building to sidewalk outer edge
    # The footpath crosses the STREET_BUILDING_CLEARANCE gap (if any)
```

### Files Changed

- `src/codecity/analysis/geojson_layout.py`

## 3. Sidewalk Length Fixes

### Problem

Sidewalks don't run the full length of the road.

### Root Cause

Sidewalks are created with the street's start/end coordinates, but the `extend_to` logic only extends backward toward the parent connector, not forward to the street's full extent.

### Solution

Sidewalks use the same start/end as the street they parallel:

```python
def _create_sidewalks(self, street_path, start, end, direction, extend_to=None):
    # extend_to extends the start backward toward parent connector
    actual_start = start
    if extend_to is not None:
        # Extend toward connector
        ...

    # The end always matches the street end (no change needed here)
    # The fix is ensuring the street itself extends far enough (see fix #1)
```

### Files Changed

- `src/codecity/analysis/geojson_layout.py`

## 4. Sidewalks as Filled Polygons

### Problem

Current sidewalks are thin lines without visual weight.

### Solution

Replace line-based sidewalks with filled rectangular polygons.

### Data Model Change

```python
# Before
@dataclass
class SidewalkFeature:
    street_path: str
    side: str  # "left" or "right"
    start: GeoCoord
    end: GeoCoord

# After
@dataclass
class SidewalkFeature:
    street_path: str
    side: str  # "left" or "right"
    corners: list[GeoCoord]  # 4 corners of polygon
```

### Geometry Calculation

For a horizontal street:

```
                                    ← STREET_WIDTH/2 + SIDEWALK_WIDTH (outer edge)
████████████████████████████████████  Sidewalk polygon
                                    ← STREET_WIDTH/2 (inner edge / street edge)
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Street
                                    ← 0 (center)
```

```python
def _create_sidewalks(self, street_path, start, end, direction, extend_to=None):
    inner_offset = STREET_WIDTH / 2
    outer_offset = STREET_WIDTH / 2 + SIDEWALK_WIDTH

    if direction == "horizontal":
        # Left sidewalk (positive y)
        left_corners = [
            GeoCoord(start.x, start.y + inner_offset),   # inner start
            GeoCoord(end.x, end.y + inner_offset),       # inner end
            GeoCoord(end.x, end.y + outer_offset),       # outer end
            GeoCoord(start.x, start.y + outer_offset),   # outer start
        ]
        # Right sidewalk (negative y)
        right_corners = [
            GeoCoord(start.x, start.y - inner_offset),
            GeoCoord(end.x, end.y - inner_offset),
            GeoCoord(end.x, end.y - outer_offset),
            GeoCoord(start.x, start.y - outer_offset),
        ]
```

### GeoJSON Output Change

```python
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

### Frontend Change

```javascript
// Before
{
    id: 'sidewalks',
    type: 'line',
    paint: {
        'line-color': '#bbbbbb',
        'line-width': 3,
    },
}

// After
{
    id: 'sidewalks',
    type: 'fill',
    paint: {
        'fill-color': '#cccccc',
        'fill-opacity': 0.8,
    },
}
```

### Flexibility for Implicit Mode

To switch to "no sidewalks" mode later:

1. Add config flag: `sidewalks_enabled: bool = True`
2. Skip `_create_sidewalks()` calls when disabled
3. Adjust footpaths to connect directly to road edge (`STREET_WIDTH / 2`)

### Files Changed

- `src/codecity/analysis/geojson_models.py` - Update `SidewalkFeature`
- `src/codecity/analysis/geojson_layout.py` - Update `_create_sidewalks()`
- `src/codecity/app/city-map.js` - Change sidewalks layer type

## 5. Stepped/Terraced Buildings

### Problem

All buildings are simple rectangular extrusions with uniform width from ground to roof.

### Solution

Each building becomes multiple stacked extrusions. Each tier's width is based on the avg line length of that tier's portion of the code.

### Tier Calculation

1. **Determine number of tiers** based on lines of code:

| Lines of Code | Visual Height | Tiers |
|---------------|---------------|-------|
| 1-50          | 1-3 stories   | 1     |
| 51-100        | 3-8 stories   | 2     |
| 101-200       | 8-15 stories  | 3     |
| 201-400       | 15-30 stories | 4     |
| 401-700       | 30-50 stories | 5     |
| 701-1000      | 50-75 stories | 6     |
| 1001-1500     | 75-100 stories| 7     |
| 1501-2500     | 100-150 stories| 8    |
| 2501-4000     | 150-200 stories| 9    |
| 4001+         | 200+ stories  | 10    |

2. **Divide file into N chunks** (N = number of tiers)

3. **Calculate each chunk's avg line length** → tier width

4. **Apply width constraints**: `MIN_BUILDING_WIDTH` to `MAX_BUILDING_WIDTH`

### Height Mapping

Use existing interpolation but split across tiers:

```python
def _calculate_tier_heights(lines_of_code: int, num_tiers: int) -> list[tuple[float, float]]:
    """Return list of (base_height, top_height) for each tier."""
    total_height = _interpolate_height(lines_of_code)
    tier_height = total_height / num_tiers

    tiers = []
    for i in range(num_tiers):
        base = i * tier_height
        top = (i + 1) * tier_height
        tiers.append((base, top))
    return tiers
```

### Width Calculation Per Tier

```python
def _calculate_tier_widths(
    file_content: str,  # Or list of line lengths
    num_tiers: int,
) -> list[float]:
    """Calculate width for each tier based on avg line length of that section."""
    lines = file_content.split('\n')
    total_lines = len(lines)
    chunk_size = total_lines // num_tiers

    widths = []
    for i in range(num_tiers):
        start_line = i * chunk_size
        end_line = (i + 1) * chunk_size if i < num_tiers - 1 else total_lines
        chunk_lines = lines[start_line:end_line]

        avg_length = sum(len(line) for line in chunk_lines) / len(chunk_lines)
        width = min(max(avg_length / 3, MIN_BUILDING_WIDTH), MAX_BUILDING_WIDTH)
        widths.append(width)

    return widths
```

### Data Flow Change

Currently, `FileMetrics` only stores `avg_line_length` for the whole file. For tiered buildings, we need per-section data.

**Option A: Store line lengths in FileMetrics**

```python
@dataclass
class FileMetrics:
    ...
    line_lengths: list[int] = field(default_factory=list)  # Length of each line
```

**Option B: Calculate tiers from avg_line_length only (approximation)**

Use a single avg and add visual variation (slight taper toward top). Less accurate but simpler.

**Recommendation:** Option A for accuracy. The line lengths are already read during analysis; just store them.

### Building Feature Changes

Each tier becomes a separate feature:

```python
@dataclass
class BuildingFeature:
    path: str
    name: str
    street: str
    language: str
    lines_of_code: int
    avg_line_length: float
    created_at: str
    last_modified: str
    corners: list[GeoCoord]
    tier: int = 0           # 0 = ground floor, 1 = second tier, etc.
    base_height: float = 0  # Extrusion base
    top_height: float = 0   # Extrusion top
```

### Frontend Changes

```javascript
// Buildings layer - use base_height and top_height from properties
{
    id: 'buildings',
    type: 'fill-extrusion',
    paint: {
        'fill-extrusion-color': [...],
        'fill-extrusion-height': ['get', 'top_height'],
        'fill-extrusion-base': ['get', 'base_height'],
        'fill-extrusion-opacity': 0.95,
    },
}
```

### Visual Example

A 150-line Python file:

```
Tier 2 (lines 101-150): avg 25 chars → width 4
    ┌────┐
    │    │  ← Narrow top
    └────┘

Tier 1 (lines 51-100): avg 35 chars → width 6
  ┌──────┐
  │      │  ← Medium middle
  └──────┘

Tier 0 (lines 1-50): avg 45 chars → width 8
┌────────┐
│        │  ← Wide base
└────────┘
```

### Files Changed

- `src/codecity/analysis/models.py` - Add `line_lengths` to `FileMetrics`
- `src/codecity/analysis/metrics.py` - Collect line lengths during analysis
- `src/codecity/analysis/geojson_models.py` - Add tier fields to `BuildingFeature`
- `src/codecity/analysis/geojson_layout.py` - Generate tiered buildings
- `src/codecity/app/city-map.js` - Use `base_height` and `top_height`

## Implementation Order

1. **Road connection fixes** - Foundation for other fixes
2. **Sidewalk length fixes** - Depends on road fixes
3. **Footpath connection fixes** - Depends on knowing sidewalk positions
4. **Sidewalks as polygons** - Visual enhancement
5. **Stepped buildings** - Independent, can be done in parallel with 1-4

## Testing

- Visual inspection of generated city for the codecity codebase itself
- Unit tests for tier calculation logic
- Unit tests for polygon corner calculations
- Verify no overlapping geometry
