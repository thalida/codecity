# Map Improvements V2 Design

**Date:** 2026-01-18
**Status:** Ready for implementation

## Overview

This design addresses five areas of improvement for the CodeCity map visualization:
1. Human-scale buildings (realistic heights like NYC/SF maps)
2. Decorative grass covering empty spaces
3. More compact city layout
4. Road click popup showing full path
5. Fix street/sidewalk connection issues

## 1. Human-Scale Buildings

### Problem
Building heights are currently 5,000m-75,000m to be visible at the map's coordinate scale (-80 to 80 degrees). This is unrealistic.

### Solution
Change coordinate normalization to use a smaller geographic area (~1km), allowing real building heights.

**Changes to `geojson_layout.py`:**
```python
# In _to_geojson():
# Change from: target_range = 80
# Change to: target_range = 0.005  # ~500m at equator
```

**Changes to `city-map.js`:**
```javascript
// Building heights in realistic meters
'fill-extrusion-height': [
    'interpolate', ['linear'], ['get', 'lines_of_code'],
    0, 3,        // min 3m (1 story)
    30, 6,       // 30 LOC = 6m (2 stories)
    100, 12,     // 100 LOC = 12m (4 stories)
    300, 30,     // 300 LOC = 30m (10 stories)
    500, 50,     // 500 LOC = 50m (16 stories)
    1000, 100,   // 1000+ LOC = 100m (33 stories max)
],
```

## 2. Decorative Grass Layer

### Approach
Generate a single polygon covering the city bounds, rendered as the bottom layer.

### New Feature Type
Add `GrassFeature` to `geojson_models.py`:
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
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {"layer": "grass"},
        }
```

### Layout Engine Changes
Add `_create_grass_area()` method that creates a grass polygon covering min/max bounds plus margin.

### Rendering
Add grass layer to `city-map.js` before streets:
```javascript
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
```

## 3. Compact Layout

### Current Constants
```python
STREET_WIDTH = 10
BUILDING_GAP = 3
BUILDING_DEPTH = 8
SIDEWALK_WIDTH = 2
min_space = 50
```

### Proposed Constants
```python
STREET_WIDTH = 6        # Narrower streets
BUILDING_GAP = 1        # Tighter building spacing
BUILDING_DEPTH = 6      # Smaller building footprints
SIDEWALK_WIDTH = 1      # Thinner sidewalks
min_space = 15          # Shorter minimum streets
```

### Impact
- Perpendicular offset reduces from ~36 to ~22 units
- Overall city becomes ~40% more compact

## 4. Road Click Popup

### Current State
Only buildings have click handlers in `main.js`.

### Add Street Click Handler
```javascript
// In main.js init()
cityMap.map.on('click', 'streets', (e) => {
    if (e.features && e.features.length > 0) {
        const props = e.features[0].properties;
        inspectorTitle.textContent = props.name || 'Street';
        inspectorContent.innerHTML = `
            <div class="field">
                <div class="label">Full Path</div>
                <div class="value">${props.path || ''}</div>
            </div>
            <div class="field">
                <div class="label">Files</div>
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

// Add cursor change on hover
cityMap.map.on('mouseenter', 'streets', () => {
    cityMap.map.getCanvas().style.cursor = 'pointer';
});
cityMap.map.on('mouseleave', 'streets', () => {
    cityMap.map.getCanvas().style.cursor = '';
});
```

## 5. Fix Connection Issues

### Issue A: Sidewalks don't extend to connector streets
**Root cause:** Sidewalks are created for the named street only, starting at `origin` which is offset from the parent street.

**Fix:** When creating a child street, extend its sidewalks back to the parent street by using the connector's start point.

### Issue B: Connectors don't visually meet parent streets
**Root cause:** The connector start point calculation uses `origin.y` for horizontal streets, but `origin` is already the offset child position.

**Fix:** In `_layout_folder()`, the connector start should use the parent street's coordinate, not the child's origin.

### Code Changes

**In `_create_main_street()`:**
```python
# Current (correct for main street):
connector_start = GeoCoord(branch_x, 0)  # Y=0 is main street center
```

**In `_layout_folder()`:**
The issue is that `connector_start` uses `origin.y` but `origin` is already the perpendicular-offset position of THIS street, not the parent.

Fix: Track parent street center and use it for connector start:
```python
if direction == "horizontal":
    # Parent street is at origin.y, child is offset from it
    # But origin IS already the offset position, so we need parent_y
    parent_y = origin.y  # This IS the child street's Y
    # The connector should go from parent center to child center
    # We need to pass parent_center_y into this method
```

**Solution:** Add `parent_center` parameter to `_layout_folder()` to track where the parent street actually is.

### Sidewalk Extension
Modify `_create_sidewalks()` to optionally extend back toward parent:
```python
def _create_sidewalks(
    self,
    street_path: str,
    start: GeoCoord,
    end: GeoCoord,
    direction: str,
    extend_start_to: GeoCoord | None = None,  # Extend sidewalk back to connector
) -> None:
```

## Files to Modify

| File | Changes |
|------|---------|
| `geojson_layout.py` | Compact constants, fix connector logic, add grass area, change coordinate scale |
| `geojson_models.py` | Add `GrassFeature` class |
| `city-map.js` | Human-scale heights, add grass layer |
| `main.js` | Add street click handler |

## Testing

1. Verify buildings render with visible 3D height at normal zoom
2. Verify grass covers all empty space
3. Verify city is more compact (visual inspection)
4. Verify clicking streets shows popup with full path
5. Verify all sidewalks connect to parent roads
6. Verify no gaps between connector streets and parent streets
7. Run existing tests to ensure no regressions
