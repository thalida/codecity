# MapLibre Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Babylon.js with MapLibre GL JS to render the code city with map-like navigation and declarative theming.

**Architecture:** Python layout engine outputs GeoJSON (streets as LineStrings, buildings as Polygons). MapLibre renders with JSON style specs for theming. WebSocket updates modify GeoJSON in-place.

**Tech Stack:** MapLibre GL JS, GeoJSON, Vitest (JS tests), pytest (Python tests)

---

## Phase 1: Foundation

### Task 1: Add MapLibre GL JS Dependency

**Files:**
- Modify: `src/codecity/app/package.json`

**Step 1: Add maplibre-gl to dependencies**

```json
{
  "name": "codecity-app",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "maplibre-gl": "^4.7.1"
  },
  "devDependencies": {
    "jsdom": "^26.0.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Install dependencies**

Run: `cd src/codecity/app && npm install`
Expected: `added X packages`

**Step 3: Commit**

```bash
git add src/codecity/app/package.json src/codecity/app/package-lock.json
git commit -m "deps: add maplibre-gl for map-based city rendering"
```

---

### Task 2: Create GeoJSON Model Classes

**Files:**
- Create: `src/codecity/analysis/geojson_models.py`
- Test: `src/codecity/analysis/tests/test_geojson_models.py`

**Step 1: Write the failing tests**

```python
# src/codecity/analysis/tests/test_geojson_models.py
from codecity.analysis.geojson_models import GeoCoord, StreetFeature, BuildingFeature


def test_geocoord_to_list():
    coord = GeoCoord(x=10.5, y=20.3)
    assert coord.to_list() == [10.5, 20.3]


def test_street_feature_road_class_primary():
    street = StreetFeature(
        path="src",
        name="src",
        depth=0,
        file_count=10,
        start=GeoCoord(0, 0),
        end=GeoCoord(100, 0),
    )
    assert street.road_class == "primary"


def test_street_feature_road_class_secondary():
    street = StreetFeature(
        path="src/components",
        name="components",
        depth=1,
        file_count=5,
        start=GeoCoord(0, 20),
        end=GeoCoord(50, 20),
    )
    assert street.road_class == "secondary"


def test_street_feature_road_class_tertiary():
    street = StreetFeature(
        path="src/components/utils",
        name="utils",
        depth=2,
        file_count=3,
        start=GeoCoord(0, 40),
        end=GeoCoord(30, 40),
    )
    assert street.road_class == "tertiary"


def test_street_feature_to_geojson():
    street = StreetFeature(
        path="src",
        name="src",
        depth=0,
        file_count=10,
        start=GeoCoord(0, 0),
        end=GeoCoord(100, 0),
    )
    geojson = street.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "LineString"
    assert geojson["geometry"]["coordinates"] == [[0, 0], [100, 0]]
    assert geojson["properties"]["id"] == "src"
    assert geojson["properties"]["name"] == "src"
    assert geojson["properties"]["road_class"] == "primary"
    assert geojson["properties"]["layer"] == "streets"


def test_building_feature_to_geojson():
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
    )
    geojson = building.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "Polygon"
    # Polygon coordinates should be closed (first coord repeated at end)
    coords = geojson["geometry"]["coordinates"][0]
    assert coords[0] == coords[-1]
    assert len(coords) == 5  # 4 corners + 1 closing
    assert geojson["properties"]["id"] == "src/main.py"
    assert geojson["properties"]["language"] == "python"
    assert geojson["properties"]["lines_of_code"] == 150
    assert geojson["properties"]["layer"] == "buildings"
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'codecity.analysis.geojson_models'`

**Step 3: Write minimal implementation**

```python
# src/codecity/analysis/geojson_models.py
from dataclasses import dataclass


@dataclass
class GeoCoord:
    """Simple x/y coordinate in city space."""

    x: float
    y: float

    def to_list(self) -> list[float]:
        return [self.x, self.y]


@dataclass
class StreetFeature:
    """A folder represented as a street (LineString)."""

    path: str
    name: str
    depth: int
    file_count: int
    start: GeoCoord
    end: GeoCoord

    @property
    def road_class(self) -> str:
        if self.depth == 0:
            return "primary"
        elif self.depth == 1:
            return "secondary"
        return "tertiary"

    def to_geojson(self) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [self.start.to_list(), self.end.to_list()],
            },
            "properties": {
                "id": self.path,
                "name": self.name,
                "path": self.path,
                "depth": self.depth,
                "file_count": self.file_count,
                "road_class": self.road_class,
                "layer": "streets",
            },
        }


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
                "layer": "buildings",
            },
        }
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_models.py -v`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_models.py src/codecity/analysis/tests/test_geojson_models.py
git commit -m "feat(analysis): add GeoJSON model classes for MapLibre"
```

---

### Task 3: Create GeoJSON Layout Engine

**Files:**
- Create: `src/codecity/analysis/geojson_layout.py`
- Test: `src/codecity/analysis/tests/test_geojson_layout.py`

**Step 1: Write the failing tests**

```python
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

    buildings = [f for f in result["features"] if f["properties"]["layer"] == "buildings"]
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

    buildings = [f for f in result["features"] if f["properties"]["layer"] == "buildings"]
    assert len(buildings) == 2

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    src_streets = [s for s in streets if s["properties"]["name"] == "src"]
    assert len(src_streets) == 1  # Only one "src" street


def test_layout_street_depth_affects_road_class():
    metrics = {
        "src/components/utils/helpers.py": make_file_metrics("src/components/utils/helpers.py"),
    }
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]

    src_street = next(s for s in streets if s["properties"]["name"] == "src")
    components_street = next(s for s in streets if s["properties"]["name"] == "components")
    utils_street = next(s for s in streets if s["properties"]["name"] == "utils")

    assert src_street["properties"]["road_class"] == "primary"
    assert components_street["properties"]["road_class"] == "secondary"
    assert utils_street["properties"]["road_class"] == "tertiary"


def test_layout_buildings_have_valid_polygon_coords():
    metrics = {"src/main.py": make_file_metrics("src/main.py")}
    engine = GeoJSONLayoutEngine()
    result = engine.layout(metrics)

    buildings = [f for f in result["features"] if f["properties"]["layer"] == "buildings"]
    building = buildings[0]

    coords = building["geometry"]["coordinates"][0]
    # Polygon must be closed (first == last)
    assert coords[0] == coords[-1]
    # Must have at least 4 unique corners + 1 closing = 5 points
    assert len(coords) >= 5
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'codecity.analysis.geojson_layout'`

**Step 3: Write minimal implementation**

```python
# src/codecity/analysis/geojson_layout.py
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from codecity.analysis.geojson_models import BuildingFeature, GeoCoord, StreetFeature
from codecity.analysis.models import FileMetrics

# Layout constants
STREET_WIDTH = 10
BUILDING_GAP = 2
BUILDING_DEPTH = 8
MIN_BUILDING_WIDTH = 4
MAX_BUILDING_WIDTH = 15


@dataclass
class GeoJSONLayoutEngine:
    """Converts file metrics into GeoJSON for MapLibre rendering."""

    streets: list[StreetFeature] = field(default_factory=list)
    buildings: list[BuildingFeature] = field(default_factory=list)
    _street_set: set[str] = field(default_factory=set)

    def layout(self, file_metrics: dict[str, FileMetrics]) -> dict:
        """Generate GeoJSON FeatureCollection from file metrics."""
        self.streets = []
        self.buildings = []
        self._street_set = set()

        # Build folder tree
        tree = self._build_tree(file_metrics.keys())

        # Layout starting from root
        self._layout_folder(
            tree=tree,
            folder_path="",
            file_metrics=file_metrics,
            depth=0,
            origin=GeoCoord(0, 0),
            direction="horizontal",
        )

        return self._to_geojson()

    def _build_tree(self, paths: list[str]) -> dict:
        """Convert flat file paths into nested folder tree."""
        tree: dict = {}
        for path in paths:
            parts = PurePosixPath(path).parts
            current = tree
            for part in parts[:-1]:  # Folders only
                current = current.setdefault(part, {})
        return tree

    def _layout_folder(
        self,
        tree: dict,
        folder_path: str,
        file_metrics: dict[str, FileMetrics],
        depth: int,
        origin: GeoCoord,
        direction: str,
    ) -> float:
        """Layout a folder as a street with buildings on both sides."""
        # Get files directly in this folder
        folder_files = [
            (path, metrics)
            for path, metrics in file_metrics.items()
            if self._parent_folder(path) == folder_path
        ]

        subfolders = list(tree.keys())

        # Calculate street length
        num_buildings = len(folder_files)
        buildings_per_side = (num_buildings + 1) // 2
        min_length = max(buildings_per_side * (MAX_BUILDING_WIDTH + BUILDING_GAP), 50)

        # Street endpoints
        if direction == "horizontal":
            start = origin
            end = GeoCoord(origin.x + min_length, origin.y)
        else:
            start = origin
            end = GeoCoord(origin.x, origin.y + min_length)

        # Create street feature (skip if already exists or is root)
        street_name = PurePosixPath(folder_path).name if folder_path else "root"
        street_key = folder_path or "root"

        if street_key not in self._street_set and folder_path:
            self._street_set.add(street_key)
            self.streets.append(
                StreetFeature(
                    path=street_key,
                    name=street_name,
                    depth=depth,
                    file_count=len(folder_files),
                    start=start,
                    end=end,
                )
            )

        # Place buildings
        self._place_buildings(
            files=folder_files,
            street_path=street_key,
            street_start=start,
            direction=direction,
        )

        # Layout subfolders
        subfolder_offset = STREET_WIDTH * 2
        for i, subfolder in enumerate(subfolders):
            subfolder_path = f"{folder_path}/{subfolder}" if folder_path else subfolder
            side = 1 if i % 2 == 0 else -1
            new_direction = "vertical" if direction == "horizontal" else "horizontal"

            t = (i + 1) / (len(subfolders) + 1)
            if direction == "horizontal":
                branch_x = start.x + t * (end.x - start.x)
                branch_origin = GeoCoord(branch_x, origin.y + side * subfolder_offset)
            else:
                branch_y = start.y + t * (end.y - start.y)
                branch_origin = GeoCoord(origin.x + side * subfolder_offset, branch_y)

            self._layout_folder(
                tree=tree[subfolder],
                folder_path=subfolder_path,
                file_metrics=file_metrics,
                depth=depth + 1,
                origin=branch_origin,
                direction=new_direction,
            )

        return min_length

    def _place_buildings(
        self,
        files: list[tuple[str, FileMetrics]],
        street_path: str,
        street_start: GeoCoord,
        direction: str,
    ) -> None:
        """Place buildings along both sides of a street."""
        for i, (path, metrics) in enumerate(files):
            side = 1 if i % 2 == 0 else -1
            position_along = (i // 2) * (MAX_BUILDING_WIDTH + BUILDING_GAP)

            width = min(
                max(metrics.avg_line_length / 3, MIN_BUILDING_WIDTH),
                MAX_BUILDING_WIDTH,
            )

            if direction == "horizontal":
                x = street_start.x + position_along
                y = street_start.y + side * (STREET_WIDTH / 2 + BUILDING_DEPTH / 2)
                corners = [
                    GeoCoord(x, y - BUILDING_DEPTH / 2),
                    GeoCoord(x + width, y - BUILDING_DEPTH / 2),
                    GeoCoord(x + width, y + BUILDING_DEPTH / 2),
                    GeoCoord(x, y + BUILDING_DEPTH / 2),
                ]
            else:
                x = street_start.x + side * (STREET_WIDTH / 2 + BUILDING_DEPTH / 2)
                y = street_start.y + position_along
                corners = [
                    GeoCoord(x - BUILDING_DEPTH / 2, y),
                    GeoCoord(x + BUILDING_DEPTH / 2, y),
                    GeoCoord(x + BUILDING_DEPTH / 2, y + width),
                    GeoCoord(x - BUILDING_DEPTH / 2, y + width),
                ]

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
                )
            )

    def _parent_folder(self, path: str) -> str:
        """Get parent folder path."""
        parts = PurePosixPath(path).parts
        return "/".join(parts[:-1])

    def _to_geojson(self) -> dict:
        """Convert all features to GeoJSON FeatureCollection."""
        features = []
        features.extend(s.to_geojson() for s in self.streets)
        features.extend(b.to_geojson() for b in self.buildings)

        return {
            "type": "FeatureCollection",
            "features": features,
        }
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_geojson_layout.py -v`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/geojson_layout.py src/codecity/analysis/tests/test_geojson_layout.py
git commit -m "feat(analysis): add GeoJSON layout engine for MapLibre"
```

---

### Task 4: Add GeoJSON API Endpoint

**Files:**
- Modify: `src/codecity/api/app.py`
- Test: `src/codecity/api/tests/test_app.py`

**Step 1: Write the failing test**

Add to `src/codecity/api/tests/test_app.py`:

```python
def test_get_city_geojson_returns_feature_collection(client, sample_repo):
    response = client.get(f"/api/city.geojson?repo_path={sample_repo}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/geo+json"

    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert "features" in data


def test_get_city_geojson_has_streets_and_buildings(client, sample_repo):
    response = client.get(f"/api/city.geojson?repo_path={sample_repo}")
    data = response.json()

    layers = {f["properties"]["layer"] for f in data["features"]}
    assert "streets" in layers
    assert "buildings" in layers
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/api/tests/test_app.py::test_get_city_geojson_returns_feature_collection -v`
Expected: FAIL with 404 (endpoint doesn't exist)

**Step 3: Add the endpoint**

Add to `src/codecity/api/app.py` after the existing `/api/city` endpoint:

```python
@app.get("/api/city.geojson")
def get_city_geojson(
    repo_path: str | None = Query(None, description="Path to git repository"),
) -> JSONResponse:
    """Return city layout as GeoJSON for MapLibre rendering."""
    from codecity.analysis.geojson_layout import GeoJSONLayoutEngine

    # Use app.state.repo_path as default if not provided
    if repo_path is None:
        if hasattr(app.state, "repo_path"):
            repo_path = str(app.state.repo_path)
        else:
            return JSONResponse(
                status_code=400,
                content={"error": "repo_path is required"},
            )
    repo = Path(repo_path).resolve()

    if not repo.exists():
        return JSONResponse(
            status_code=404,
            content={"error": f"Repository not found: {repo_path}"},
        )

    files = get_repo_files(repo)
    file_metrics_dict: dict[str, FileMetrics] = {}

    for file_path in files:
        full_path = repo / file_path
        if not full_path.is_file():
            continue

        metrics_dict = calculate_file_metrics(full_path)
        history = get_file_git_history(repo, file_path)

        file_metrics_dict[file_path] = FileMetrics(
            path=file_path,
            lines_of_code=metrics_dict["lines_of_code"],
            avg_line_length=metrics_dict["avg_line_length"],
            language=metrics_dict["language"],
            created_at=history["created_at"],
            last_modified=history["last_modified"],
        )

    engine = GeoJSONLayoutEngine()
    geojson = engine.layout(file_metrics_dict)

    return JSONResponse(
        content=geojson,
        media_type="application/geo+json",
    )
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/api/tests/test_app.py -v -k geojson`
Expected: All geojson tests PASS

**Step 5: Commit**

```bash
git add src/codecity/api/app.py src/codecity/api/tests/test_app.py
git commit -m "feat(api): add /api/city.geojson endpoint for MapLibre"
```

---

### Task 5: Create Default MapLibre Style

**Files:**
- Create: `src/codecity/app/styles/default.json`

**Step 1: Create the styles directory and default style**

```json
{
  "version": 8,
  "name": "CodeCity Default",
  "sources": {},
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": {
        "background-color": "#e8e8e0"
      }
    }
  ]
}
```

**Step 2: Verify file is valid JSON**

Run: `python -c "import json; json.load(open('src/codecity/app/styles/default.json'))"`
Expected: No output (valid JSON)

**Step 3: Commit**

```bash
git add src/codecity/app/styles/default.json
git commit -m "feat(app): add default MapLibre style"
```

---

### Task 6: Create CityMap Class

**Files:**
- Create: `src/codecity/app/city-map.js`
- Test: `src/codecity/app/__tests__/city-map.test.js`

**Step 1: Write the failing tests**

```javascript
// src/codecity/app/__tests__/city-map.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock maplibre-gl
vi.mock('maplibre-gl', () => ({
    default: {
        Map: vi.fn().mockImplementation(() => ({
            on: vi.fn((event, callback) => {
                if (event === 'load') callback();
            }),
            addSource: vi.fn(),
            addLayer: vi.fn(),
            addControl: vi.fn(),
            getSource: vi.fn(() => ({ _data: { features: [] }, setData: vi.fn() })),
            setStyle: vi.fn(),
        })),
        NavigationControl: vi.fn(),
        ScaleControl: vi.fn(),
    },
}));

import { CityMap } from '../city-map.js';

describe('CityMap', () => {
    let mockContainer;

    beforeEach(() => {
        mockContainer = document.createElement('div');
        mockContainer.id = 'map';
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('stores container reference', () => {
            const cityMap = new CityMap(mockContainer);
            expect(cityMap.container).toBe(mockContainer);
        });

        it('defaults theme to default', () => {
            const cityMap = new CityMap(mockContainer);
            expect(cityMap.theme).toBe('default');
        });

        it('accepts custom theme option', () => {
            const cityMap = new CityMap(mockContainer, { theme: 'dark' });
            expect(cityMap.theme).toBe('dark');
        });
    });

    describe('calculateBounds', () => {
        it('calculates bounds from geojson features', () => {
            const cityMap = new CityMap(mockContainer);
            const geojson = {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [[0, 0], [100, 50]],
                        },
                    },
                    {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[10, 10], [20, 10], [20, 60], [10, 60], [10, 10]]],
                        },
                    },
                ],
            };

            const bounds = cityMap.calculateBounds(geojson);
            expect(bounds).toEqual([[0, 0], [100, 60]]);
        });
    });

    describe('setTheme', () => {
        it('updates theme property', async () => {
            const cityMap = new CityMap(mockContainer);
            await cityMap.init('/api/city.geojson');

            cityMap.setTheme('dark');
            expect(cityMap.theme).toBe('dark');
        });
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd src/codecity/app && npm test -- --run city-map`
Expected: FAIL with `Cannot find module '../city-map.js'`

**Step 3: Write the implementation**

```javascript
// src/codecity/app/city-map.js
import maplibregl from 'maplibre-gl';

export class CityMap {
    constructor(container, options = {}) {
        this.container = container;
        this.theme = options.theme || 'default';
        this.map = null;
        this.cityData = null;
    }

    async init(cityDataUrl) {
        // Fetch city data
        const response = await fetch(cityDataUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch city data: ${response.statusText}`);
        }
        this.cityData = await response.json();

        const bounds = this.calculateBounds(this.cityData);

        this.map = new maplibregl.Map({
            container: this.container,
            style: `/styles/${this.theme}.json`,
            bounds: bounds,
            fitBoundsOptions: { padding: 50 },
            pitch: 45,
            bearing: -15,
            antialias: true,
        });

        this.map.on('load', () => {
            this.map.addSource('city', {
                type: 'geojson',
                data: this.cityData,
            });
            this.addLayers();
            this.addNavigationControls();
        });
    }

    calculateBounds(geojson) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        const processCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                minX = Math.min(minX, coords[0]);
                minY = Math.min(minY, coords[1]);
                maxX = Math.max(maxX, coords[0]);
                maxY = Math.max(maxY, coords[1]);
            } else {
                coords.forEach(processCoords);
            }
        };

        geojson.features.forEach((f) => processCoords(f.geometry.coordinates));
        return [[minX, minY], [maxX, maxY]];
    }

    addLayers() {
        // Streets
        this.map.addLayer({
            id: 'streets',
            type: 'line',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'streets'],
            paint: {
                'line-color': '#ffffff',
                'line-width': 8,
            },
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
        });

        // Buildings (flat for now, will add extrusion later)
        this.map.addLayer({
            id: 'buildings',
            type: 'fill',
            source: 'city',
            filter: ['==', ['get', 'layer'], 'buildings'],
            paint: {
                'fill-color': '#888888',
                'fill-outline-color': '#333333',
            },
        });
    }

    addNavigationControls() {
        this.map.addControl(new maplibregl.NavigationControl());
        this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    }

    setTheme(themeName) {
        this.theme = themeName;
        this.map.setStyle(`/styles/${themeName}.json`);
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd src/codecity/app && npm test -- --run city-map`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-map.js src/codecity/app/__tests__/city-map.test.js
git commit -m "feat(app): add CityMap class for MapLibre rendering"
```

---

### Task 7: Create New Index HTML for MapLibre

**Files:**
- Create: `src/codecity/app/index-maplibre.html`

**Step 1: Create the new HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CodeCity - 3D Code Visualization</title>
    <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
    <link rel="stylesheet" href="styles-maplibre.css">
</head>
<body>
    <!-- Map Container -->
    <div id="map"></div>

    <!-- Inspector Panel -->
    <div id="inspector" class="side-panel">
        <div class="side-panel-header">
            <h2 id="inspector-title">File Details</h2>
            <button id="inspector-close" class="side-panel-close">&times;</button>
        </div>
        <div class="side-panel-content">
            <div class="panel-field">
                <label>File Path</label>
                <span id="inspector-path">-</span>
            </div>
            <div class="panel-field">
                <label>Language</label>
                <span id="inspector-language">-</span>
            </div>
            <div class="panel-field">
                <label>Lines of Code</label>
                <span id="inspector-loc">-</span>
            </div>
            <div class="panel-field">
                <label>Average Line Length</label>
                <span id="inspector-avg-line">-</span>
            </div>
            <div class="panel-field">
                <label>Created</label>
                <span id="inspector-created">-</span>
            </div>
            <div class="panel-field">
                <label>Last Modified</label>
                <span id="inspector-modified">-</span>
            </div>
        </div>
        <div class="side-panel-actions">
            <button id="btn-open-editor" class="panel-btn">Open in Editor</button>
            <button id="btn-view-remote" class="panel-btn">View on GitHub</button>
        </div>
    </div>

    <!-- Tooltip -->
    <div id="tooltip" class="tooltip"></div>

    <!-- Loading Overlay -->
    <div id="loading-overlay" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p class="loading-text">Loading city...</p>
    </div>

    <!-- MapLibre GL JS -->
    <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>

    <!-- Main Application -->
    <script type="module" src="main-maplibre.js"></script>
</body>
</html>
```

**Step 2: Create basic styles**

```css
/* src/codecity/app/styles-maplibre.css */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    overflow: hidden;
}

#map {
    width: 100vw;
    height: 100vh;
}

/* Side Panel */
.side-panel {
    position: fixed;
    top: 0;
    left: -320px;
    width: 320px;
    height: 100vh;
    background: #1a1a2e;
    color: #ffffff;
    transition: left 0.3s ease;
    z-index: 1000;
    display: flex;
    flex-direction: column;
}

.side-panel.open {
    left: 0;
}

.side-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #2d2d44;
}

.side-panel-header h2 {
    font-size: 18px;
    font-weight: 600;
}

.side-panel-close {
    background: none;
    border: none;
    color: #888;
    font-size: 24px;
    cursor: pointer;
}

.side-panel-close:hover {
    color: #fff;
}

.side-panel-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
}

.panel-field {
    margin-bottom: 16px;
}

.panel-field label {
    display: block;
    font-size: 12px;
    color: #888;
    margin-bottom: 4px;
    text-transform: uppercase;
}

.panel-field span {
    display: block;
    font-size: 14px;
    word-break: break-all;
}

.side-panel-actions {
    padding: 16px;
    border-top: 1px solid #2d2d44;
}

.panel-btn {
    display: block;
    width: 100%;
    padding: 12px;
    margin-bottom: 8px;
    background: #3178c6;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
}

.panel-btn:hover {
    background: #2868b6;
}

.panel-btn:last-child {
    margin-bottom: 0;
}

/* Tooltip */
.tooltip {
    display: none;
    position: fixed;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 13px;
    pointer-events: none;
    z-index: 999;
}

/* Loading Overlay */
.loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(26, 26, 46, 0.95);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 2000;
}

.loading-overlay.hidden {
    display: none;
}

.loading-spinner {
    width: 48px;
    height: 48px;
    border: 4px solid #2d2d44;
    border-top-color: #3178c6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.loading-text {
    margin-top: 16px;
    color: #888;
    font-size: 14px;
}
```

**Step 3: Commit**

```bash
git add src/codecity/app/index-maplibre.html src/codecity/app/styles-maplibre.css
git commit -m "feat(app): add MapLibre HTML and CSS"
```

---

### Task 8: Create Main MapLibre Entry Point

**Files:**
- Create: `src/codecity/app/main-maplibre.js`

**Step 1: Create the entry point**

```javascript
// src/codecity/app/main-maplibre.js
// MapLibre-based CodeCity Application

import { CityMap } from './city-map.js';
import { Inspector } from './inspector.js';

class CodeCityApp {
    constructor() {
        this.mapContainer = document.getElementById('map');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.cityMap = null;
        this.inspector = null;
    }

    async init() {
        try {
            this.showLoading();

            // Initialize inspector
            this.inspector = new Inspector();

            // Get repo path from URL params
            const urlParams = new URLSearchParams(window.location.search);
            const repoPath = urlParams.get('repo');

            // Build API URL
            const apiUrl = repoPath
                ? `/api/city.geojson?repo_path=${encodeURIComponent(repoPath)}`
                : '/api/city.geojson';

            // Initialize city map
            const theme = localStorage.getItem('codecity-theme') || 'default';
            this.cityMap = new CityMap(this.mapContainer, { theme });
            await this.cityMap.init(apiUrl);

            // Setup interactions after map loads
            this.cityMap.map.on('load', () => {
                this.setupInteractions();
                this.hideLoading();
            });
        } catch (error) {
            console.error('Failed to initialize CodeCity:', error);
            this.hideLoading();
        }
    }

    setupInteractions() {
        const map = this.cityMap.map;

        // Hover: show tooltip
        map.on('mousemove', 'buildings', (e) => {
            map.getCanvas().style.cursor = 'pointer';
            if (e.features.length > 0) {
                const props = e.features[0].properties;
                this.showTooltip(e.point, props.name);
            }
        });

        map.on('mouseleave', 'buildings', () => {
            map.getCanvas().style.cursor = '';
            this.hideTooltip();
        });

        // Click: open inspector
        map.on('click', 'buildings', (e) => {
            if (e.features.length > 0) {
                const props = e.features[0].properties;
                this.inspector.show({
                    file_path: props.path,
                    language: props.language,
                    height: props.lines_of_code,
                    width: props.avg_line_length,
                    created_at: props.created_at,
                    last_modified: props.last_modified,
                });
            }
        });
    }

    showTooltip(point, text) {
        const tooltip = document.getElementById('tooltip');
        tooltip.textContent = text;
        tooltip.style.display = 'block';
        tooltip.style.left = `${point.x + 10}px`;
        tooltip.style.top = `${point.y + 10}px`;
    }

    hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        tooltip.style.display = 'none';
    }

    showLoading() {
        this.loadingOverlay.classList.remove('hidden');
    }

    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new CodeCityApp();
    app.init().catch(console.error);
});
```

**Step 2: Commit**

```bash
git add src/codecity/app/main-maplibre.js
git commit -m "feat(app): add MapLibre main entry point"
```

---

### Task 9: Serve Static Files for MapLibre

**Files:**
- Modify: `src/codecity/api/app.py`

**Step 1: Add route for styles directory and maplibre index**

Add before the final static mount:

```python
@app.get("/styles/{filename}")
async def get_style(filename: str) -> FileResponse:
    """Serve MapLibre style files."""
    styles_dir = APP_DIR / "styles"
    file_path = styles_dir / filename
    if not file_path.exists():
        return JSONResponse(status_code=404, content={"error": "Style not found"})
    return FileResponse(file_path, media_type="application/json")

@app.get("/maplibre")
async def index_maplibre() -> FileResponse:
    """Serve MapLibre version of the app."""
    return FileResponse(APP_DIR / "index-maplibre.html")
```

**Step 2: Verify the server starts**

Run: `uv run codecity serve . &`
Run: `curl -s http://localhost:8000/styles/default.json | head -1`
Expected: `{`

**Step 3: Commit**

```bash
git add src/codecity/api/app.py
git commit -m "feat(api): add routes for MapLibre styles and index"
```

---

### Task 10: Manual Integration Test

**Step 1: Start the server**

Run: `uv run codecity serve .`

**Step 2: Open browser**

Open: `http://localhost:8000/maplibre`

**Step 3: Verify**

Expected:
- Map loads with gray background
- Streets appear as white lines
- Buildings appear as gray polygons
- Can pan/zoom the map
- Console has no errors

**Step 4: Document any issues**

If issues found, create follow-up tasks.

---

## Phase 1 Complete Checkpoint

At this point you should have:

- [x] MapLibre GL JS installed
- [x] GeoJSON model classes with tests
- [x] GeoJSON layout engine with tests
- [x] `/api/city.geojson` endpoint
- [x] Default style JSON
- [x] CityMap class with tests
- [x] New HTML/CSS for MapLibre
- [x] Main entry point
- [x] Static file serving
- [x] Working basic rendering (flat streets + buildings)

**Run full test suite before continuing:**

```bash
just test && just lint && just typecheck
```

---

## Phase 2: Core Features (Coming Next)

Phase 2 will add:
- 3D building extrusions
- Language-based coloring
- Street labels
- Click/hover interactions with inspector
- Theme switching (dark mode)

Continue to Phase 2 after Phase 1 checkpoint passes.
