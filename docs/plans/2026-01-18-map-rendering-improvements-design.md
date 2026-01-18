# Map Rendering Improvements Design

**Date:** 2026-01-18
**Status:** Ready for implementation

## Overview

Improve the MapLibre-based city visualization with:
1. Street labels that follow the road direction
2. Fix building overlap issues
3. Disable map tiling when zooming out
4. 3D extruded buildings based on lines of code
5. Sidewalks along streets and curved footpaths to buildings

## 1. Map Configuration Fixes

### World Wrapping (No Tiling)
- Add `renderWorldCopies: false` to MapLibre map options
- Prevents duplicate maps when zooming out far

### Street Labels
- Add a new `symbol` layer for street names
- Text follows the street line direction (`symbol-placement: 'line'`)
- Use the existing `name` property from street features
- Styling: white text with dark halo for readability, size based on `road_class`

**Implementation:** `src/codecity/app/city-map.js` in `addLayers()` method

## 2. Building Overlap Fix

### Root Cause
The current layout places subfolders at a fixed offset (`STREET_WIDTH * 2 = 20 units`) from the parent street, but doesn't account for:
- Buildings on the parent street extending into that space
- Subfolder streets and their buildings needing more clearance

### Solution: Dynamic Spacing
- Calculate the actual space needed based on building placement
- Increase subfolder offset to account for: parent buildings + gap + subfolder buildings
- New offset formula: `STREET_WIDTH + BUILDING_DEPTH + BUILDING_GAP + STREET_WIDTH/2`
- This ensures subfolder streets start beyond where parent buildings end

### Additional Safeguard
- Track bounding boxes of placed buildings
- When placing new buildings, check for collisions and adjust if needed

**Implementation:** `src/codecity/analysis/geojson_layout.py` in `_layout_folder()` method

## 3. 3D Building Extrusion

### Layer Change
- Replace current `fill` layer with `fill-extrusion` layer type
- This enables true 3D rendering with height

### Height Calculation
- Building height based on `lines_of_code` property
- Scale factor to keep heights reasonable (e.g., `lines_of_code * 0.1` or capped range)
- Minimum height (e.g., 5 units) so small files are still visible
- Maximum height cap to prevent skyscrapers from dominating

### Extrusion Properties
```javascript
'fill-extrusion-height': ['*', ['get', 'lines_of_code'], 0.1]
'fill-extrusion-base': 0
'fill-extrusion-color': '#888888'  // or language-based coloring
'fill-extrusion-opacity': 0.9
```

### Lighting
- MapLibre provides automatic lighting for extruded fills
- The existing 45° pitch will show the 3D effect nicely

**Implementation:** `src/codecity/app/city-map.js` - modify `buildings` layer in `addLayers()`

## 4. Sidewalks and Footpaths

### Sidewalks
- New GeoJSON features: `layer: 'sidewalks'`
- Rendered as thin lines parallel to streets on both sides
- Offset from street center: `STREET_WIDTH/2 + SIDEWALK_OFFSET` (e.g., 1-2 units from street edge)
- Visual style: lighter gray than streets, thinner line width (~2px)

### Footpaths
- New GeoJSON features: `layer: 'footpaths'`
- One path per building connecting to nearest sidewalk
- Gentle curve using quadratic bezier: start at building edge, curve toward sidewalk
- Generated as LineString with 3-5 interpolated points to create curve
- Visual style: very thin (~1px), subtle color (light gray or slightly different tone)

### Layout Engine Changes
- New constant: `SIDEWALK_OFFSET = 1`
- When creating a street, also create two parallel sidewalk LineStrings
- When placing a building, generate a curved footpath from building center-edge to sidewalk

### Render Order (bottom to top)
1. Streets (base layer)
2. Sidewalks (on top of streets)
3. Footpaths (connecting to sidewalks)
4. Buildings (3D extruded, on top)

**Implementation locations:**
- `src/codecity/analysis/geojson_layout.py` - generate sidewalk and footpath features
- `src/codecity/analysis/geojson_models.py` - new `SidewalkFeature` and `FootpathFeature` classes
- `src/codecity/app/city-map.js` - add `sidewalks` and `footpaths` layers

## Files to Modify

| File | Changes |
|------|---------|
| `src/codecity/app/city-map.js` | Add `renderWorldCopies: false`, street labels layer, sidewalk/footpath layers, convert buildings to fill-extrusion |
| `src/codecity/analysis/geojson_layout.py` | Fix subfolder offset spacing, generate sidewalks and footpaths |
| `src/codecity/analysis/geojson_models.py` | Add `SidewalkFeature` and `FootpathFeature` dataclasses |

## Testing Considerations

- Verify no building overlaps with various repository structures
- Test street labels readability at different zoom levels
- Confirm 3D buildings render with appropriate heights
- Check sidewalks and footpaths connect properly to buildings
- Verify map doesn't tile when zooming out completely
