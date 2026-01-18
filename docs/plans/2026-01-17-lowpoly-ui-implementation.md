# Low-Poly UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement low-poly visual style with district-based folder visualization, road networks, and distance-based file labels.

**Architecture:** Backend adds district colors and road width to Street model. Frontend renders colored ground plates per folder, dark roads between districts, signposts at intersections, and billboard labels that fade based on camera distance.

**Tech Stack:** Python dataclasses, Babylon.js, Babylon.js GUI for labels

---

## Task 1: Add District Color Palette to Defaults

**Files:**
- Modify: `src/codecity/config/defaults.py`
- Test: `src/codecity/config/tests/test_defaults.py`

**Step 1: Write the failing test**

Add to `src/codecity/config/tests/test_defaults.py`:

```python
def test_district_colors_has_palette():
    from codecity.config.defaults import DISTRICT_COLORS
    assert len(DISTRICT_COLORS) >= 6
    for color in DISTRICT_COLORS:
        assert len(color) == 3
        assert all(0 <= c <= 255 for c in color)


def test_get_district_color_cycles():
    from codecity.config.defaults import get_district_color
    color0 = get_district_color(0)
    color6 = get_district_color(6)
    assert color0 == color6  # Should cycle


def test_get_district_color_with_depth():
    from codecity.config.defaults import get_district_color
    base = get_district_color(0, depth=0)
    nested = get_district_color(0, depth=1)
    # Nested should be lighter
    assert nested[0] >= base[0] or nested[1] >= base[1] or nested[2] >= base[2]
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/config/tests/test_defaults.py::test_district_colors_has_palette -v`
Expected: FAIL with "cannot import name 'DISTRICT_COLORS'"

**Step 3: Write minimal implementation**

Add to `src/codecity/config/defaults.py`:

```python
# Muted earthy tones for district ground colors (RGB 0-255)
DISTRICT_COLORS: list[tuple[int, int, int]] = [
    (89, 98, 117),   # slate blue
    (117, 98, 89),   # warm brown
    (89, 117, 98),   # sage green
    (107, 89, 117),  # muted purple
    (117, 107, 89),  # tan
    (89, 107, 117),  # steel blue
]


def get_district_color(index: int, depth: int = 0) -> tuple[int, int, int]:
    """Get district color by index, cycling through palette. Deeper = lighter."""
    base = DISTRICT_COLORS[index % len(DISTRICT_COLORS)]
    # Lighten by 15 per depth level, max 40
    lighten = min(depth * 15, 40)
    return (
        min(base[0] + lighten, 255),
        min(base[1] + lighten, 255),
        min(base[2] + lighten, 255),
    )
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/config/tests/test_defaults.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/config/defaults.py src/codecity/config/tests/test_defaults.py
git commit -m "feat(config): add district color palette"
```

---

## Task 2: Extend Street Model with Color and Road Width

**Files:**
- Modify: `src/codecity/analysis/models.py`
- Test: `src/codecity/analysis/tests/test_models.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_models.py`:

```python
def test_street_has_color_field():
    street = Street(path="src", name="src", color=(89, 98, 117))
    assert street.color == (89, 98, 117)


def test_street_has_road_width_field():
    street = Street(path="src", name="src", road_width=2.0)
    assert street.road_width == 2.0


def test_street_default_color_is_none():
    street = Street(path="src", name="src")
    assert street.color is None


def test_street_default_road_width():
    street = Street(path="src", name="src")
    assert street.road_width == 1.5
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_models.py::test_street_has_color_field -v`
Expected: FAIL with "unexpected keyword argument 'color'"

**Step 3: Write minimal implementation**

Modify `Street` dataclass in `src/codecity/analysis/models.py`:

```python
@dataclass
class Street:
    path: str
    name: str
    x: float = 0.0
    z: float = 0.0
    width: float = 10.0
    length: float = 100.0
    buildings: list[Building] = field(default_factory=list)
    substreets: list["Street"] = field(default_factory=list)
    color: tuple[int, int, int] | None = None
    road_width: float = 1.5
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_models.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/models.py src/codecity/analysis/tests/test_models.py
git commit -m "feat(models): add color and road_width to Street"
```

---

## Task 3: Assign District Colors in Layout

**Files:**
- Modify: `src/codecity/analysis/layout.py`
- Test: `src/codecity/analysis/tests/test_layout.py`

**Step 1: Write the failing test**

Add to `src/codecity/analysis/tests/test_layout.py`:

```python
def test_layout_assigns_district_colors():
    from codecity.analysis.layout import generate_city_layout
    from codecity.analysis.models import FileMetrics
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/a.py", 10, 5.0, "python", now, now),
        FileMetrics("tests/b.py", 20, 6.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    # Top-level streets should have colors
    src_street = next(s for s in city.root.substreets if s.name == "src")
    tests_street = next(s for s in city.root.substreets if s.name == "tests")

    assert src_street.color is not None
    assert tests_street.color is not None
    assert src_street.color != tests_street.color  # Different colors


def test_layout_nested_streets_have_lighter_colors():
    from codecity.analysis.layout import generate_city_layout
    from codecity.analysis.models import FileMetrics
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/sub/a.py", 10, 5.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    src_street = next(s for s in city.root.substreets if s.name == "src")
    sub_street = next(s for s in src_street.substreets if s.name == "sub")

    # Nested street color should be lighter (higher values)
    assert sub_street.color is not None
    assert any(sub_street.color[i] >= src_street.color[i] for i in range(3))


def test_layout_road_width_decreases_with_depth():
    from codecity.analysis.layout import generate_city_layout
    from codecity.analysis.models import FileMetrics
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/sub/a.py", 10, 5.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    src_street = next(s for s in city.root.substreets if s.name == "src")
    sub_street = next(s for s in src_street.substreets if s.name == "sub")

    assert src_street.road_width > sub_street.road_width
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_layout_assigns_district_colors -v`
Expected: FAIL with "color is None" assertion

**Step 3: Write minimal implementation**

Modify `src/codecity/analysis/layout.py`:

```python
from pathlib import PurePosixPath

from codecity.analysis.models import Building, City, FileMetrics, Street
from codecity.config.defaults import get_district_color


def generate_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Generate a city layout from file metrics."""
    root = Street(path="", name="root")

    for file_metrics in files:
        _add_file_to_city(root, file_metrics)

    _assign_colors(root, color_index=0, depth=0)
    _calculate_positions(root, 0, 0)

    return City(root=root, repo_path=repo_path)


def _assign_colors(street: Street, color_index: int, depth: int) -> int:
    """Assign colors to streets. Returns next color index."""
    if street.name != "root":
        street.color = get_district_color(color_index, depth)
        street.road_width = max(2.5 - depth * 0.5, 0.5)
        color_index += 1

    for substreet in street.substreets:
        color_index = _assign_colors(substreet, color_index, depth + 1)

    return color_index


def _add_file_to_city(root: Street, metrics: FileMetrics) -> None:
    """Add a file to the city structure, creating streets as needed."""
    path = PurePosixPath(metrics.path)
    parts = path.parts

    current_street = root

    for i, part in enumerate(parts[:-1]):
        street_path = "/".join(parts[: i + 1])
        existing = next(
            (s for s in current_street.substreets if s.name == part),
            None,
        )

        if existing:
            current_street = existing
        else:
            new_street = Street(path=street_path, name=part)
            current_street.substreets.append(new_street)
            current_street = new_street

    building = Building.from_metrics(metrics)
    current_street.buildings.append(building)


def _calculate_positions(
    street: Street, start_x: float, start_z: float
) -> tuple[float, float]:
    """Calculate positions for streets and buildings. Returns (width, depth) used."""
    street.x = start_x
    street.z = start_z

    current_x = start_x + 5
    max_z = start_z

    building_z = start_z + 5
    for building in street.buildings:
        building.x = current_x
        building.z = building_z
        current_x += building.width + 3
        max_z = max(max_z, building_z + building.depth)

    substreet_x = start_x
    substreet_z = max_z + 10

    for substreet in street.substreets:
        w, d = _calculate_positions(substreet, substreet_x, substreet_z)
        substreet_x += w + 10

    street.width = max(current_x - start_x, substreet_x - start_x)
    street.length = max(max_z - start_z, 20)

    return street.width, street.length
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/layout.py src/codecity/analysis/tests/test_layout.py
git commit -m "feat(layout): assign district colors and road widths"
```

---

## Task 4: Update API to Include New Street Fields

**Files:**
- Modify: `src/codecity/api/app.py`
- Test: `src/codecity/api/tests/test_app.py`

**Step 1: Write the failing test**

Add to `src/codecity/api/tests/test_app.py`:

```python
@pytest.mark.asyncio
async def test_city_endpoint_includes_street_color(
    client: AsyncClient, temp_git_repo: Path
) -> None:
    response = await client.get("/api/city", params={"repo_path": str(temp_git_repo)})
    assert response.status_code == 200
    data = response.json()
    # Root won't have color, but if there are substreets they should
    # For this test, the temp repo has files in root, so check structure exists
    assert "root" in data
    root = data["root"]
    assert "color" in root
    assert "road_width" in root
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/api/tests/test_app.py::test_city_endpoint_includes_street_color -v`
Expected: FAIL with "KeyError: 'color'"

**Step 3: Write minimal implementation**

Modify `_city_to_dict` in `src/codecity/api/app.py`, update `street_to_dict`:

```python
def _city_to_dict(city: City) -> dict:
    """Convert City dataclass to JSON-serializable dict."""

    def street_to_dict(street) -> dict:
        return {
            "path": street.path,
            "name": street.name,
            "x": street.x,
            "z": street.z,
            "width": street.width,
            "length": street.length,
            "color": street.color,
            "road_width": street.road_width,
            "buildings": [
                {
                    "file_path": b.file_path,
                    "height": b.height,
                    "width": b.width,
                    "depth": b.depth,
                    "language": b.language,
                    "created_at": b.created_at.isoformat(),
                    "last_modified": b.last_modified.isoformat(),
                    "x": b.x,
                    "z": b.z,
                }
                for b in street.buildings
            ],
            "substreets": [street_to_dict(s) for s in street.substreets],
        }

    return {
        "repo_path": city.repo_path,
        "generated_at": city.generated_at.isoformat(),
        "root": street_to_dict(city.root),
    }
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/api/tests/test_app.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/api/app.py src/codecity/api/tests/test_app.py
git commit -m "feat(api): include street color and road_width in response"
```

---

## Task 5: Update CityRenderer for Flat Materials and Districts

**Files:**
- Modify: `src/codecity/app/city-renderer.js`

**Step 1: Update building materials to flat shading**

Modify `renderBuilding` method in `src/codecity/app/city-renderer.js`:

```javascript
renderBuilding(building) {
    const height = Math.max(building.height / 10, 1);
    const width = Math.max(building.width / 5, 2);
    const depth = width;

    const mesh = BABYLON.MeshBuilder.CreateBox(
        `building_${building.file_path}`,
        { width, height, depth },
        this.scene
    );

    mesh.position.x = building.x + width / 2;
    mesh.position.y = height / 2;
    mesh.position.z = building.z + depth / 2;

    // Flat material - no specular highlights
    const material = new BABYLON.StandardMaterial(`mat_${building.file_path}`, this.scene);
    const color = this.calculateBuildingColor(building);
    material.diffuseColor = color;
    material.specularColor = new BABYLON.Color3(0, 0, 0);  // No specular
    mesh.material = material;

    mesh.metadata = {
        type: 'building',
        data: building,
    };

    mesh.actionManager = new BABYLON.ActionManager(this.scene);
    mesh.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(
            BABYLON.ActionManager.OnPickTrigger,
            () => this.inspector.show(building)
        )
    );

    this.buildings.set(building.file_path, mesh);
}
```

**Step 2: Update renderStreet to render colored districts and roads**

Replace `renderStreet` method:

```javascript
renderStreet(street, isRoot = false) {
    // Render district ground (colored plate)
    if (street.width > 0 && street.length > 0 && street.color) {
        const districtMesh = BABYLON.MeshBuilder.CreateBox(
            `district_${street.path}`,
            {
                width: street.width,
                height: 0.1,
                depth: street.length,
            },
            this.scene
        );
        districtMesh.position.x = street.x + street.width / 2;
        districtMesh.position.y = 0.05;
        districtMesh.position.z = street.z + street.length / 2;

        const districtMat = new BABYLON.StandardMaterial(`districtMat_${street.path}`, this.scene);
        // Convert RGB 0-255 to 0-1
        districtMat.diffuseColor = new BABYLON.Color3(
            street.color[0] / 255,
            street.color[1] / 255,
            street.color[2] / 255
        );
        districtMat.specularColor = new BABYLON.Color3(0, 0, 0);
        districtMesh.material = districtMat;

        this.streets.push(districtMesh);
    }

    // Render road at district boundary
    if (street.road_width > 0 && street.width > 0 && !isRoot) {
        const roadMesh = BABYLON.MeshBuilder.CreateBox(
            `road_${street.path}`,
            {
                width: street.width + street.road_width * 2,
                height: 0.12,
                depth: street.road_width,
            },
            this.scene
        );
        roadMesh.position.x = street.x + street.width / 2;
        roadMesh.position.y = 0.06;
        roadMesh.position.z = street.z - street.road_width / 2;

        const roadMat = new BABYLON.StandardMaterial(`roadMat_${street.path}`, this.scene);
        roadMat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.14);
        roadMat.specularColor = new BABYLON.Color3(0, 0, 0);
        roadMesh.material = roadMat;

        this.streets.push(roadMesh);
    }

    // Render buildings
    for (const building of street.buildings) {
        this.renderBuilding(building);
    }

    // Render sub-streets
    for (const substreet of street.substreets) {
        this.renderStreet(substreet, false);
    }
}
```

**Step 3: Update render method call**

```javascript
render(cityData) {
    this.clear();
    this.renderStreet(cityData.root, true);
}
```

**Step 4: Manual test**

Run: `just serve`
Open: `http://localhost:3000`
Expected: Districts have colored ground plates, roads appear as dark strips

**Step 5: Commit**

```bash
git add src/codecity/app/city-renderer.js
git commit -m "feat(renderer): flat materials, colored districts, roads"
```

---

## Task 6: Add Folder Signposts

**Files:**
- Modify: `src/codecity/app/city-renderer.js`

**Step 1: Add signpost rendering method**

Add to `CityRenderer` class in `src/codecity/app/city-renderer.js`:

```javascript
constructor(scene, inspector) {
    this.scene = scene;
    this.inspector = inspector;
    this.buildings = new Map();
    this.streets = [];
    this.signposts = [];  // Add this
}

clear() {
    for (const mesh of this.buildings.values()) {
        mesh.dispose();
    }
    this.buildings.clear();

    for (const mesh of this.streets) {
        mesh.dispose();
    }
    this.streets = [];

    // Add signpost cleanup
    for (const signpost of this.signposts) {
        signpost.dispose();
    }
    this.signposts = [];
}

renderSignpost(street) {
    if (!street.name || street.name === 'root') return;

    // Create post
    const post = BABYLON.MeshBuilder.CreateCylinder(
        `signpost_post_${street.path}`,
        { height: 3, diameter: 0.2 },
        this.scene
    );
    post.position.x = street.x + 1;
    post.position.y = 1.5;
    post.position.z = street.z - 1;

    const postMat = new BABYLON.StandardMaterial(`signpostMat_${street.path}`, this.scene);
    postMat.diffuseColor = new BABYLON.Color3(0.3, 0.25, 0.2);
    postMat.specularColor = new BABYLON.Color3(0, 0, 0);
    post.material = postMat;

    // Create sign plane with text
    const sign = BABYLON.MeshBuilder.CreatePlane(
        `signpost_sign_${street.path}`,
        { width: Math.max(street.name.length * 0.4, 2), height: 0.8 },
        this.scene
    );
    sign.position.x = street.x + 1 + Math.max(street.name.length * 0.2, 1);
    sign.position.y = 2.8;
    sign.position.z = street.z - 1;
    sign.rotation.y = Math.PI / 2;

    // Create dynamic texture for text
    const textureWidth = Math.max(street.name.length * 40, 128);
    const texture = new BABYLON.DynamicTexture(
        `signTexture_${street.path}`,
        { width: textureWidth, height: 64 },
        this.scene
    );
    texture.hasAlpha = true;

    const ctx = texture.getContext();
    ctx.fillStyle = 'rgba(40, 40, 45, 0.9)';
    ctx.fillRect(0, 0, textureWidth, 64);
    ctx.font = 'bold 32px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText(street.name, textureWidth / 2, 44);
    texture.update();

    const signMat = new BABYLON.StandardMaterial(`signMat_${street.path}`, this.scene);
    signMat.diffuseTexture = texture;
    signMat.specularColor = new BABYLON.Color3(0, 0, 0);
    signMat.backFaceCulling = false;
    sign.material = signMat;

    this.signposts.push(post);
    this.signposts.push(sign);
}
```

**Step 2: Call renderSignpost in renderStreet**

Add at end of `renderStreet` method before sub-streets loop:

```javascript
// Render signpost
this.renderSignpost(street);

// Render sub-streets
for (const substreet of street.substreets) {
    this.renderStreet(substreet, false);
}
```

**Step 3: Manual test**

Run: `just serve`
Open: `http://localhost:3000`
Expected: Signposts with folder names appear at district entrances

**Step 4: Commit**

```bash
git add src/codecity/app/city-renderer.js
git commit -m "feat(renderer): add folder signposts"
```

---

## Task 7: Add Distance-Based File Labels

**Files:**
- Modify: `src/codecity/app/city-renderer.js`
- Modify: `src/codecity/app/main.js`
- Modify: `src/codecity/app/index.html`

**Step 1: Add Babylon.js GUI script to index.html**

Read `src/codecity/app/index.html` and add GUI script after Babylon.js:

```html
<script src="https://cdn.babylonjs.com/gui/babylon.gui.min.js"></script>
```

**Step 2: Add label management to CityRenderer**

Add to constructor and clear in `src/codecity/app/city-renderer.js`:

```javascript
constructor(scene, inspector) {
    this.scene = scene;
    this.inspector = inspector;
    this.buildings = new Map();
    this.streets = [];
    this.signposts = [];
    this.labels = new Map();  // file_path -> label
    this.advancedTexture = null;
}

clear() {
    for (const mesh of this.buildings.values()) {
        mesh.dispose();
    }
    this.buildings.clear();

    for (const mesh of this.streets) {
        mesh.dispose();
    }
    this.streets = [];

    for (const signpost of this.signposts) {
        signpost.dispose();
    }
    this.signposts = [];

    // Clear labels
    for (const label of this.labels.values()) {
        label.dispose();
    }
    this.labels.clear();

    if (this.advancedTexture) {
        this.advancedTexture.dispose();
        this.advancedTexture = null;
    }
}
```

**Step 3: Initialize GUI and create labels**

Add method and update render:

```javascript
render(cityData) {
    this.clear();

    // Create fullscreen UI for labels
    this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');

    this.renderStreet(cityData.root, true);
}

createBuildingLabel(building, mesh) {
    const filename = building.file_path.split('/').pop();

    const label = new BABYLON.GUI.TextBlock();
    label.text = filename;
    label.color = 'white';
    label.fontSize = 14;
    label.outlineWidth = 2;
    label.outlineColor = 'black';
    label.alpha = 0;  // Start hidden

    const rect = new BABYLON.GUI.Rectangle();
    rect.width = '150px';
    rect.height = '30px';
    rect.cornerRadius = 4;
    rect.color = 'transparent';
    rect.background = 'transparent';
    rect.addControl(label);

    this.advancedTexture.addControl(rect);
    rect.linkWithMesh(mesh);
    rect.linkOffsetY = -40;

    this.labels.set(building.file_path, rect);
}
```

**Step 4: Update renderBuilding to create label**

Add at end of `renderBuilding`:

```javascript
this.buildings.set(building.file_path, mesh);
this.createBuildingLabel(building, mesh);  // Add this line
```

**Step 5: Add hover handlers**

Update renderBuilding to show label on hover:

```javascript
// Add hover handlers for label
mesh.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPointerOverTrigger,
        () => {
            const label = this.labels.get(building.file_path);
            if (label) label.alpha = 1;
        }
    )
);
mesh.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPointerOutTrigger,
        () => {
            // Let distance-based visibility take over
        }
    )
);
```

**Step 6: Add distance-based visibility update method**

Add to CityRenderer:

```javascript
updateLabelVisibility(camera) {
    const cameraPos = camera.position;

    for (const [filePath, label] of this.labels) {
        const mesh = this.buildings.get(filePath);
        if (!mesh) continue;

        const distance = BABYLON.Vector3.Distance(cameraPos, mesh.position);
        const buildingHeight = mesh.scaling?.y || 1;

        // Larger buildings visible from farther away
        const fadeStart = 40 + buildingHeight * 3;
        const fadeEnd = 25 + buildingHeight * 3;

        if (distance < fadeEnd) {
            label.alpha = 1;
        } else if (distance < fadeStart) {
            label.alpha = (fadeStart - distance) / (fadeStart - fadeEnd);
        } else {
            label.alpha = 0;
        }
    }
}
```

**Step 7: Update main.js to call visibility update**

Modify `src/codecity/app/main.js` init method, add after render loop setup:

```javascript
// Start render loop
this.engine.runRenderLoop(() => {
    this.scene.render();

    // Update label visibility based on camera distance
    if (this.cityRenderer && this.camera) {
        this.cityRenderer.updateLabelVisibility(this.camera);
    }
});
```

**Step 8: Manual test**

Run: `just serve`
Open: `http://localhost:3000`
Expected:
- Labels hidden when zoomed out
- Labels fade in as you zoom closer
- Labels appear immediately on hover

**Step 9: Commit**

```bash
git add src/codecity/app/city-renderer.js src/codecity/app/main.js src/codecity/app/index.html
git commit -m "feat(renderer): add distance-based file labels"
```

---

## Task 8: Remove Old Ground Plane

**Files:**
- Modify: `src/codecity/app/main.js`

**Step 1: Remove createGround method call**

In `src/codecity/app/main.js`, comment out or remove the `createGround()` call in `init()`:

```javascript
// Remove this line:
// this.createGround();
```

Districts now serve as the ground, so the single dark plane is no longer needed.

**Step 2: Manual test**

Run: `just serve`
Expected: No more single dark ground plane, districts provide ground

**Step 3: Commit**

```bash
git add src/codecity/app/main.js
git commit -m "refactor(app): remove old ground plane, districts are ground"
```

---

## Task 9: Run Full Test Suite and Verify

**Step 1: Run all checks**

```bash
just test && just lint && just typecheck
```

Expected: All tests pass, no lint errors, no type errors

**Step 2: Manual visual verification**

Run: `just serve`
Verify:
- [ ] Buildings have flat colors (no shine)
- [ ] Districts have colored ground plates
- [ ] Roads appear as dark strips between districts
- [ ] Signposts show folder names
- [ ] Labels fade in on zoom
- [ ] Labels appear on hover
- [ ] Click on building still opens inspector

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete low-poly UI redesign"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | District color palette | defaults.py |
| 2 | Street model color/road_width | models.py |
| 3 | Assign colors in layout | layout.py |
| 4 | API includes new fields | app.py |
| 5 | Flat materials, districts, roads | city-renderer.js |
| 6 | Folder signposts | city-renderer.js |
| 7 | Distance-based labels | city-renderer.js, main.js, index.html |
| 8 | Remove old ground | main.js |
| 9 | Verify all works | - |
