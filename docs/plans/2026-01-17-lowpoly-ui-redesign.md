# Low-Poly UI Redesign

## Overview

Redesign the CodeCity 3D visualization with a low-poly aesthetic, improved information density through district-based folder visualization, road networks, and distance-based file labels.

## Goals

1. **Visual style**: Clean low-poly aesthetic with flat shading
2. **Information density**: See folder structure and file names at a glance
3. **Navigation**: Clear district boundaries and road-based folder paths

## Design

### Visual Style

Buildings are simple geometric boxes with flat-shaded materials (no smooth gradients, no specular highlights). Colors remain vibrant - language determines hue, file age affects saturation, recency affects lightness.

Materials:
- **Buildings**: Flat diffuse color only, no specular
- **Districts**: Matte colored surfaces (muted earthy tones)
- **Roads**: Slightly darker than surrounding districts

The overall look is clean and game-like (Monument Valley, Mini Metro) rather than photorealistic.

### District Layout

Each top-level folder becomes a distinct "district" with its own ground color. The color palette uses muted, earthy tones that don't compete with building colors.

Nested folders create lighter/darker variations of the parent district color. Example for `src/codecity/`:
- `src/` district: slate blue ground
- `src/codecity/config/` neighborhood: lighter slate
- `src/codecity/analysis/` neighborhood: slightly different shade

### Road Network

Each folder boundary is marked by a road - a thin dark strip between districts/neighborhoods. Roads form a grid-like network with width scaling by folder depth:
- Top-level folders: wider "main roads"
- Nested folders: narrower "side streets"

Buildings sit within their district, set back slightly from roads.

### Folder Signposts

At road intersections, small 3D signpost meshes display folder names. Always visible, using clean sans-serif white text with dark outline. Signs show just the current folder name, not full path.

### File Labels

Labels float above buildings as billboard-style text (always facing camera). White text with subtle dark outline.

Visibility:
- **Zoomed out**: No labels (clean overview)
- **Medium distance**: Labels fade in, larger buildings first
- **Close up**: All labels visible in current view
- **Hover**: Label always appears immediately

Labels show filename only (not full path) since district/road structure provides folder context.

### Building Dimensions (Unchanged)

- **Height** = lines of code
- **Width** = average line length
- **Color hue** = language
- **Color saturation** = file age (older = more saturated)
- **Color lightness** = last modified (recent = lighter)

## Implementation

### Files to Modify

| File | Changes |
|------|---------|
| `defaults.py` | Add district color palette |
| `models.py` | Extend Street with color, road_width fields |
| `layout.py` | District color assignment, road positioning |
| `city-renderer.js` | Flat materials, districts, roads, labels, signposts |
| `main.js` | Label visibility tied to camera distance |

### Data Model Changes

**Street model additions:**
```python
@dataclass
class Street:
    # existing fields...
    color: tuple[int, int, int]  # RGB for district ground
    road_width: float  # width of road at this level
```

**District color palette** (muted earthy tones):
```python
DISTRICT_COLORS = [
    (89, 98, 117),   # slate blue
    (117, 98, 89),   # warm brown
    (89, 117, 98),   # sage green
    (107, 89, 117),  # muted purple
    (117, 107, 89),  # tan
    (89, 107, 117),  # steel blue
]
```

### Rendering Changes

**Buildings:**
```javascript
// Remove specular, use flat diffuse only
material.specularColor = new BABYLON.Color3(0, 0, 0);
material.diffuseColor = buildingColor;
```

**Districts:**
```javascript
// Render district ground plates instead of single dark ground
const districtMesh = BABYLON.MeshBuilder.CreateGround(...);
districtMesh.material.diffuseColor = districtColor;
```

**Roads:**
```javascript
// Thin dark strips between districts
const roadMesh = BABYLON.MeshBuilder.CreateGround(...);
roadMesh.material.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.12);
```

**Labels:**
```javascript
// Billboard text using Babylon.js GUI
const label = new BABYLON.GUI.TextBlock();
label.text = filename;
// Visibility controlled by camera.radius threshold
```

**Signposts:**
```javascript
// Simple post + sign mesh at folder intersections
const post = BABYLON.MeshBuilder.CreateCylinder(...);
const sign = BABYLON.MeshBuilder.CreatePlane(...);
// Apply text texture with folder name
```

### Label Visibility Logic

```javascript
scene.registerBeforeRender(() => {
    const cameraDistance = camera.radius;

    for (const [filePath, label] of buildingLabels) {
        const building = buildings.get(filePath);
        const distanceToBuilding = Vector3.Distance(camera.target, building.position);

        // Fade in based on distance, prioritize larger buildings
        const buildingSize = building.scaling.y;
        const fadeStart = 30 + buildingSize * 2;
        const fadeEnd = 20 + buildingSize * 2;

        if (distanceToBuilding < fadeEnd) {
            label.alpha = 1;
        } else if (distanceToBuilding < fadeStart) {
            label.alpha = (fadeStart - distanceToBuilding) / (fadeStart - fadeEnd);
        } else {
            label.alpha = 0;
        }
    }
});

// Hover always shows label
mesh.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPointerOverTrigger,
        () => label.alpha = 1
    )
);
```

## What Stays the Same

- Building dimension mappings
- Inspector panel behavior
- WebSocket live updates
- API structure
- Click-to-select functionality

## Testing

- Visual regression: Screenshot comparison before/after
- Performance: Measure FPS with large repos (1000+ files)
- Label visibility: Verify fade behavior at different zoom levels
- District colors: Verify nested folders use correct shade variations
