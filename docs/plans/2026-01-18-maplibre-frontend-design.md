# MapLibre Frontend Design for CodeCity

## Overview

Replace the current Babylon.js-based renderer with MapLibre GL JS to achieve:

1. **Richer map features** - Native roads, terrain, water, labels
2. **Better theming** - Swap JSON style files for instant theme changes
3. **Different aesthetics** - Map-like navigation (pan/zoom/tilt like Google Maps)
4. **Easier extensibility** - Declarative layers, built-in interactions

The city metaphor remains: folders become streets, files become buildings. Users navigate like exploring a real city map.

---

## Section 1: Data Model - GeoJSON Structure

The Python layout engine outputs GeoJSON that MapLibre renders.

### Streets (Folders → LineStrings)

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[0, 0], [0, 100]]
      },
      "properties": {
        "id": "src",
        "name": "src",
        "path": "src",
        "depth": 0,
        "file_count": 45,
        "road_class": "primary",
        "layer": "streets"
      }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[0, 20], [50, 20]]
      },
      "properties": {
        "id": "src/components",
        "name": "components",
        "path": "src/components",
        "depth": 1,
        "file_count": 12,
        "road_class": "secondary",
        "layer": "streets"
      }
    }
  ]
}
```

**Road class logic:**
- `depth: 0` → "primary" (main avenues)
- `depth: 1` → "secondary" (major streets)
- `depth: 2+` → "tertiary" (side streets, alleys)

### Buildings (Files → Polygons)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[2, 22], [8, 22], [8, 28], [2, 28], [2, 22]]]
  },
  "properties": {
    "id": "src/components/Button.tsx",
    "name": "Button.tsx",
    "path": "src/components/Button.tsx",
    "street": "src/components",
    "lines_of_code": 120,
    "avg_line_length": 35,
    "language": "typescript",
    "created_at": "2024-03-15",
    "last_modified": "2026-01-10",
    "layer": "buildings"
  }
}
```

### Decorations (Parks, Trees)

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[100, 50], [130, 50], [130, 80], [100, 80], [100, 50]]]
  },
  "properties": {
    "type": "park",
    "name": "Test Garden",
    "layer": "decorations"
  }
}
```

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [110, 65]
  },
  "properties": {
    "type": "tree",
    "variant": "oak",
    "layer": "decorations"
  }
}
```

---

## Section 2: Style Spec - Visual Rules

The style spec is a JSON file that controls all visual appearance. Swap the JSON file to change themes.

### Layer Stack (bottom to top)

```
building-labels     ← hover labels
street-labels       ← folder names along roads
buildings-3d        ← extruded file buildings
trees               ← decoration sprites
roads-primary       ← root folder streets
roads-secondary     ← depth-1 streets
roads-tertiary      ← deeper streets
parks               ← green spaces
ground              ← background
```

### Ground Layer

```json
{
  "id": "ground",
  "type": "background",
  "paint": {
    "background-color": "#e8e8e0"
  }
}
```

### Road Layers

```json
{
  "id": "roads-primary",
  "type": "line",
  "source": "city",
  "filter": ["all",
    ["==", ["get", "layer"], "streets"],
    ["==", ["get", "road_class"], "primary"]
  ],
  "paint": {
    "line-color": "#ffffff",
    "line-width": [
      "interpolate", ["linear"], ["zoom"],
      10, 4,
      16, 20
    ]
  },
  "layout": {
    "line-cap": "round",
    "line-join": "round"
  }
}
```

### Street Labels

```json
{
  "id": "street-labels",
  "type": "symbol",
  "source": "city",
  "filter": ["==", ["get", "layer"], "streets"],
  "layout": {
    "symbol-placement": "line",
    "text-field": ["get", "name"],
    "text-size": [
      "interpolate", ["linear"], ["zoom"],
      12, 10,
      16, 16
    ],
    "text-anchor": "center",
    "text-max-angle": 30
  },
  "paint": {
    "text-color": "#555555",
    "text-halo-color": "#ffffff",
    "text-halo-width": 2
  }
}
```

### Buildings (3D Extrusion)

```json
{
  "id": "buildings-3d",
  "type": "fill-extrusion",
  "source": "city",
  "filter": ["==", ["get", "layer"], "buildings"],
  "paint": {
    "fill-extrusion-color": [
      "match", ["get", "language"],
      "typescript", "#3178c6",
      "javascript", "#f7df1e",
      "python", "#3572A5",
      "rust", "#dea584",
      "go", "#00ADD8",
      "#888888"
    ],
    "fill-extrusion-height": [
      "interpolate", ["linear"], ["get", "lines_of_code"],
      0, 5,
      100, 20,
      500, 50,
      1000, 80
    ],
    "fill-extrusion-opacity": 0.9
  }
}
```

### Parks

```json
{
  "id": "parks",
  "type": "fill",
  "source": "city",
  "filter": ["==", ["get", "type"], "park"],
  "paint": {
    "fill-color": "#c8e6c9",
    "fill-opacity": 0.8
  }
}
```

### Trees

```json
{
  "id": "trees",
  "type": "symbol",
  "source": "city",
  "filter": ["==", ["get", "type"], "tree"],
  "layout": {
    "icon-image": "tree-icon",
    "icon-size": [
      "interpolate", ["linear"], ["zoom"],
      12, 0.3,
      16, 1
    ],
    "icon-allow-overlap": true
  }
}
```

### Theming

Create alternate style JSON files with different colors:

| Property | Light Theme | Dark Theme |
|----------|-------------|------------|
| `background-color` | `#e8e8e0` | `#1a1a2e` |
| `line-color` (roads) | `#ffffff` | `#2d2d44` |
| `text-color` | `#555555` | `#a0a0a0` |
| `fill-extrusion-opacity` | `0.9` | `0.85` |

Switch themes with: `map.setStyle('/styles/dark.json')`

---

## Section 3: Frontend Architecture

### File Structure

```
src/codecity/app/
├── index.html
├── main.js              # Entry point
├── city-map.js          # MapLibre wrapper
├── interactions.js      # Click, hover, inspector
├── live-updates.js      # WebSocket handling
├── themes.js            # Theme switching
├── inspector.js         # Side panel (existing)
├── styles/
│   ├── default.json     # Light theme
│   ├── dark.json        # Dark theme
│   └── blueprint.json   # Fun alternative
└── sprites/
    └── sprites.png      # Tree icons, markers
```

### Core Map Class (city-map.js)

```javascript
import maplibregl from 'maplibre-gl';

export class CityMap {
  constructor(container, options = {}) {
    this.map = null;
    this.container = container;
    this.theme = options.theme || 'default';
  }

  async init(cityDataUrl) {
    const cityData = await fetch(cityDataUrl).then(r => r.json());
    const bounds = this.calculateBounds(cityData);

    this.map = new maplibregl.Map({
      container: this.container,
      style: `/styles/${this.theme}.json`,
      bounds: bounds,
      fitBoundsOptions: { padding: 50 },
      pitch: 45,
      bearing: -15,
      antialias: true
    });

    this.map.on('load', () => {
      this.map.addSource('city', {
        type: 'geojson',
        data: cityData
      });
      this.addNavigationControls();
    });
  }

  calculateBounds(geojson) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

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

    geojson.features.forEach(f => processCoords(f.geometry.coordinates));
    return [[minX, minY], [maxX, maxY]];
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

### Interactions (interactions.js)

```javascript
export function setupInteractions(cityMap, inspector) {
  const map = cityMap.map;

  // Hover: highlight + tooltip
  map.on('mousemove', 'buildings-3d', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const props = e.features[0].properties;
    showTooltip(e.lngLat, props.name);

    map.setFeatureState(
      { source: 'city', id: e.features[0].id },
      { hover: true }
    );
  });

  map.on('mouseleave', 'buildings-3d', () => {
    map.getCanvas().style.cursor = '';
    hideTooltip();
    map.removeFeatureState({ source: 'city' }, 'hover');
  });

  // Click: open inspector
  map.on('click', 'buildings-3d', (e) => {
    const feature = e.features[0];
    inspector.show(feature.properties);

    map.flyTo({
      center: e.lngLat,
      zoom: 16,
      pitch: 60
    });
  });

  // Double-click: open in editor
  map.on('dblclick', 'buildings-3d', (e) => {
    const filePath = e.features[0].properties.path;
    openInEditor(filePath);
    e.preventDefault();
  });
}

async function openInEditor(filePath) {
  await fetch('/api/open-in-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  });
}
```

### Live Updates (live-updates.js)

```javascript
export function setupLiveUpdates(cityMap) {
  const ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onmessage = (event) => {
    const update = JSON.parse(event.data);
    const source = cityMap.map.getSource('city');
    const data = source._data;

    switch (update.type) {
      case 'building:added':
        data.features.push(update.feature);
        break;

      case 'building:modified':
        const idx = data.features.findIndex(
          f => f.properties.id === update.feature.properties.id
        );
        if (idx !== -1) data.features[idx] = update.feature;
        break;

      case 'building:removed':
        data.features = data.features.filter(
          f => f.properties.id !== update.id
        );
        break;

      case 'full-refresh':
        source.setData(update.data);
        return;
    }

    source.setData(data);
  };
}
```

### Entry Point (main.js)

```javascript
import { CityMap } from './city-map.js';
import { Inspector } from './inspector.js';
import { setupInteractions } from './interactions.js';
import { setupLiveUpdates } from './live-updates.js';

async function main() {
  const inspector = new Inspector(document.getElementById('inspector'));
  const cityMap = new CityMap('map-container', {
    theme: localStorage.getItem('theme') || 'default'
  });

  await cityMap.init('/api/city.geojson');

  setupInteractions(cityMap, inspector);
  setupLiveUpdates(cityMap);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const newTheme = cityMap.theme === 'default' ? 'dark' : 'default';
    cityMap.setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

main();
```

---

## Section 4: Python Layout Engine Changes

### New Model Classes

```python
# src/codecity/analysis/models.py

from dataclasses import dataclass
from pathlib import Path

@dataclass
class GeoCoord:
    x: float
    y: float

    def to_list(self) -> list[float]:
        return [self.x, self.y]

@dataclass
class StreetFeature:
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
                "coordinates": [self.start.to_list(), self.end.to_list()]
            },
            "properties": {
                "id": self.path,
                "name": self.name,
                "path": self.path,
                "depth": self.depth,
                "file_count": self.file_count,
                "road_class": self.road_class,
                "layer": "streets"
            }
        }

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

    def to_geojson(self) -> dict:
        coords = [c.to_list() for c in self.corners]
        coords.append(coords[0])  # Close polygon

        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords]
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
                "layer": "buildings"
            }
        }
```

### Layout Engine

```python
# src/codecity/analysis/geojson_layout.py

from dataclasses import dataclass, field
from pathlib import Path
from .models import GeoCoord, StreetFeature, BuildingFeature

STREET_WIDTH = 10
BUILDING_GAP = 2
BUILDING_DEPTH = 8
MIN_BUILDING_WIDTH = 4
MAX_BUILDING_WIDTH = 15

@dataclass
class GeoJSONLayoutEngine:
    streets: list[StreetFeature] = field(default_factory=list)
    buildings: list[BuildingFeature] = field(default_factory=list)

    def layout(self, root_path: Path, file_metrics: dict) -> dict:
        tree = self._build_tree(file_metrics.keys())

        self._layout_folder(
            tree=tree,
            folder_path="",
            file_metrics=file_metrics,
            depth=0,
            origin=GeoCoord(0, 0),
            direction="horizontal"
        )

        return self._to_geojson()

    def _build_tree(self, paths: list[str]) -> dict:
        tree = {}
        for path in paths:
            parts = Path(path).parts
            current = tree
            for part in parts[:-1]:
                current = current.setdefault(part, {})
        return tree

    def _layout_folder(
        self,
        tree: dict,
        folder_path: str,
        file_metrics: dict,
        depth: int,
        origin: GeoCoord,
        direction: str
    ) -> float:
        folder_files = [
            (path, metrics)
            for path, metrics in file_metrics.items()
            if self._parent_folder(path) == folder_path
        ]

        subfolders = list(tree.keys())

        num_buildings = len(folder_files)
        buildings_per_side = (num_buildings + 1) // 2
        min_length = buildings_per_side * (MAX_BUILDING_WIDTH + BUILDING_GAP)

        if direction == "horizontal":
            start = origin
            end = GeoCoord(origin.x + max(min_length, 50), origin.y)
        else:
            start = origin
            end = GeoCoord(origin.x, origin.y + max(min_length, 50))

        street_name = Path(folder_path).name if folder_path else "root"
        self.streets.append(StreetFeature(
            path=folder_path or "root",
            name=street_name,
            depth=depth,
            file_count=len(folder_files),
            start=start,
            end=end
        ))

        self._place_buildings(
            files=folder_files,
            street_path=folder_path or "root",
            street_start=start,
            street_end=end,
            direction=direction
        )

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
                direction=new_direction
            )

        return max(min_length, 50)

    def _place_buildings(
        self,
        files: list[tuple[str, any]],
        street_path: str,
        street_start: GeoCoord,
        street_end: GeoCoord,
        direction: str
    ):
        for i, (path, metrics) in enumerate(files):
            side = 1 if i % 2 == 0 else -1
            position_along = (i // 2) * (MAX_BUILDING_WIDTH + BUILDING_GAP)

            width = min(
                max(metrics.avg_line_length / 3, MIN_BUILDING_WIDTH),
                MAX_BUILDING_WIDTH
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

            self.buildings.append(BuildingFeature(
                path=path,
                name=Path(path).name,
                street=street_path,
                language=metrics.language,
                lines_of_code=metrics.lines_of_code,
                avg_line_length=metrics.avg_line_length,
                created_at=metrics.created_at.isoformat(),
                last_modified=metrics.last_modified.isoformat(),
                corners=corners
            ))

    def _parent_folder(self, path: str) -> str:
        parts = Path(path).parts
        return "/".join(parts[:-1])

    def _to_geojson(self) -> dict:
        features = []
        features.extend(s.to_geojson() for s in self.streets)
        features.extend(b.to_geojson() for b in self.buildings)

        return {
            "type": "FeatureCollection",
            "features": features
        }
```

### API Endpoint

```python
# Add to src/codecity/api/app.py

@app.get("/api/city.geojson")
async def get_city_geojson(path: str = "."):
    file_metrics = analyze_repository(path)
    engine = GeoJSONLayoutEngine()
    geojson = engine.layout(Path(path), file_metrics)

    return JSONResponse(
        content=geojson,
        media_type="application/geo+json"
    )
```

---

## Section 5: Implementation Phases

### Phase 1: Foundation

**Goal:** Streets and buildings render in MapLibre.

- [ ] `npm install maplibre-gl`
- [ ] Create `styles/default.json` with background + basic layers
- [ ] Create `src/codecity/analysis/geojson_layout.py`
- [ ] Add `/api/city.geojson` endpoint
- [ ] Create `city-map.js` with basic init
- [ ] Verify flat streets + buildings render

### Phase 2: Core Features

**Goal:** 3D buildings, interactions, theming work.

- [ ] Add `fill-extrusion` layer for 3D buildings
- [ ] Add language-based color matching
- [ ] Add street labels with `symbol-placement: line`
- [ ] Implement hover cursor + tooltip
- [ ] Implement click → inspector panel
- [ ] Create `styles/dark.json`
- [ ] Implement theme toggle button

### Phase 3: Polish & Decorations

**Goal:** Looks polished, optional fun elements.

- [ ] Style roads by depth (primary/secondary/tertiary widths)
- [ ] Add park generation to layout engine
- [ ] Add tree scattering to layout engine
- [ ] Add park + tree layers to style
- [ ] Tune building height interpolation for visual balance
- [ ] Add smooth fly-to animations

### Phase 4: Live Updates

**Goal:** Real-time updates, remove old code.

- [ ] Connect WebSocket in `city-map.js`
- [ ] Implement `handleUpdate` for add/modify/remove
- [ ] Update Python watcher to emit GeoJSON features
- [ ] Test live reload with file edits
- [ ] Remove Babylon.js code (`city-renderer.js`)
- [ ] Remove Babylon.js dependencies

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering library | MapLibre GL JS | Native map navigation, declarative styling, built-in labels |
| Data format | GeoJSON | Standard format MapLibre consumes directly |
| Coordinate system | Arbitrary x/y | Not real geography, but MapLibre handles it fine |
| Theming | JSON style files | Swap entire look by loading different file |
| 3D buildings | fill-extrusion | Native MapLibre layer type, good performance |
| Custom 3D objects | Three.js custom layer | For trees/decorations beyond sprites |

---

## Open Questions

1. **Coordinate scale** - What x/y range works best? Start with 1 unit = 1 "meter" in city space?
2. **Tree placement algorithm** - Random scatter in parks, or deliberate patterns?
3. **Additional themes** - Blueprint? Satellite? Night neon?
4. **Mobile support** - Touch gestures work by default, but test inspector panel UX
