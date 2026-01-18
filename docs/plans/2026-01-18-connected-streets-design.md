# Connected Streets Layout Design

## Overview

Replace the current isolated district layout with a connected street network where roads form a navigable path through the directory tree. Users can "walk" from the root to any file by following continuous streets.

## Design Decisions

1. **Linear "Main Street" style** - Each folder has a main road; child folders branch perpendicular
2. **Packed rows on both sides** - Files pack tightly along both sides of the road
3. **T-intersection connections** - Subfolders branch off as side streets
4. **Strip Packing algorithm** - Folders stack as horizontal strips, O(n) performance

## Visual Model

```
Example structure:
root/
├── src/
│   ├── main.py
│   ├── utils.py
│   ├── config.py
│   └── api/
│       ├── server.py
│       └── routes.py
├── tests/
│   └── test_main.py
└── README.md

Rendered city (vertical main street, horizontal side streets):

         ║
         ║    ┌────────┐
    root ╠════╧════════╧════
         ║    │ README │
         ║    └────────┘
         ║
         ║        ┌───────────┐
   tests ╠════════╧═══════════╧════
         ║        │ test_main │
         ║        └───────────┘
         ║
         ║    ┌──────┬───────┬────────┐
     src ╠════╧══════╧═══════╧════════╧════╦════
         ║    │ main │ utils │ config │    ║
         ║    └──────┴───────┴────────┘    ║
         ║                                 ║
         ║                      ┌────────┬─╨──────┐
         ║                  api ═════════╧════════╧════
         ║                      │ server │ routes │
         ║                      └────────┴────────┘
         ▼
```

Key features:

- Main street runs vertically (║)
- Each folder branches horizontally (═)
- Buildings pack in rows on both sides of their folder's street
- Subfolders nest visually within parent's horizontal extent

## Data Model Changes

### New: Grid-Based Layout

Replace the current tree-of-districts model with a tile grid:

```python
@dataclass
class Tile:
    """A single cell in the city grid."""
    x: int
    z: int
    tile_type: TileType
    node_path: str           # File or folder this tile belongs to
    parent_path: str | None  # Parent folder path

class TileType(Enum):
    EMPTY = 0           # Unoccupied space
    ROAD = 1            # Walkable road segment
    INTERSECTION = 2    # Where roads meet
    BUILDING = 3        # File representation
    ROAD_START = 4      # Entry point to a street
    ROAD_END = 5        # Dead end of a street
```

### Updated City Model

```python
@dataclass
class City:
    grid: dict[tuple[int, int], Tile]  # (x, z) -> Tile
    buildings: dict[str, Building]      # file_path -> Building
    streets: dict[str, Street]          # folder_path -> Street
    repo_path: str
    bounds: tuple[int, int, int, int]   # min_x, min_z, max_x, max_z
```

### Street Metadata

```python
@dataclass
class Street:
    path: str
    name: str
    start: tuple[int, int]      # Grid coords where street starts
    end: tuple[int, int]        # Grid coords where street ends
    direction: Direction        # HORIZONTAL or VERTICAL
    branch_point: tuple[int, int] | None  # Where it connects to parent
    color: tuple[int, int, int]
    depth: int
```


## Layout Algorithm: Strip Packing with Inline Streets

This algorithm uses a bottom-up approach inspired by rectangle packing research. It achieves O(n) performance by avoiding collision detection entirely - instead, it pre-calculates exact dimensions and places elements deterministically.

### Why Strip Packing?

Traditional recursive placement with collision resolution has problems:

- **Unpredictable performance**: Collision resolution can require many iterations
- **Sprawling layouts**: Sliding elements to avoid collisions creates gaps
- **Complex implementation**: Need to handle edge cases in collision detection

Strip packing solves these by:

- **Pre-calculating sizes**: Know exact dimensions before placing anything
- **Deterministic placement**: No backtracking or adjustment needed
- **Linear complexity**: Single pass through the tree


### Phase 1: Calculate Strip Dimensions (Bottom-Up)

Process the tree from leaves to root, calculating the bounding box each folder needs:

```python
@dataclass
class StripDimensions:
    """Dimensions needed for a folder's strip."""
    width: int    # Horizontal extent (for files + subfolder widths)
    height: int   # Vertical extent (for files + subfolder heights stacked)

def calculate_dimensions(folder: Folder) -> StripDimensions:
    """Calculate dimensions bottom-up. O(n) - visits each node once."""

    # Base case: files only
    file_columns = ceil(len(folder.files) / 2)  # 2 files per column (both sides)
    file_width = file_columns + 1  # +1 for the road itself
    file_height = 3  # road + buildings on both sides

    if not folder.subfolders:
        return StripDimensions(width=file_width, height=file_height)

    # Recursive case: include subfolders
    subfolder_dims = [calculate_dimensions(sf) for sf in folder.subfolders]

    # Subfolders stack vertically, each offset horizontally
    max_subfolder_width = max(d.width for d in subfolder_dims)
    total_subfolder_height = sum(d.height for d in subfolder_dims)

    return StripDimensions(
        width=max(file_width, max_subfolder_width + 1),  # +1 for main street
        height=file_height + total_subfolder_height
    )
```


### Phase 2: Place Elements (Top-Down)

With dimensions known, place everything in a single pass:

```python
def layout_folder(
    folder: Folder,
    dims: dict[str, StripDimensions],
    main_street_x: int,
    start_z: int,
    grid: dict,
    buildings: dict,
    streets: dict
) -> int:
    """
    Layout a folder and its contents. Returns z position after this folder.

    Args:
        folder: The folder to layout
        dims: Pre-calculated dimensions for all folders
        main_street_x: X coordinate of the vertical main street
        start_z: Z coordinate to start this folder's strip
        grid: Output grid of tiles
        buildings: Output building dict
        streets: Output street dict
    """
    folder_dims = dims[folder.path]
    current_z = start_z

    # 1. Place this folder's horizontal street
    street_start = (main_street_x, current_z)
    street_width = folder_dims.width

    for x in range(main_street_x, main_street_x + street_width):
        tile_type = TileType.INTERSECTION if x == main_street_x else TileType.ROAD
        grid[(x, current_z)] = Tile(x, current_z, tile_type, folder.path)

    streets[folder.path] = Street(
        path=folder.path,
        name=folder.name,
        start=street_start,
        end=(main_street_x + street_width - 1, current_z),
        direction=Direction.HORIZONTAL
    )

    # 2. Place files packed in rows on both sides of the street
    file_x = main_street_x + 1  # Start after intersection
    for i, file in enumerate(folder.files):
        side = 1 if i % 2 == 0 else -1  # Alternate sides
        column = i // 2

        building = Building.from_metrics(file)
        building.grid_x = file_x + column
        building.grid_z = current_z
        building.road_side = side
        buildings[file.path] = building

    current_z += 1  # Move past this folder's street + files

    # 3. Place subfolders recursively, stacked vertically
    subfolder_x = main_street_x + 1  # Indent from parent's main street

    for subfolder in folder.subfolders:
        # Add connecting road segment on main street
        grid[(main_street_x, current_z)] = Tile(
            main_street_x, current_z, TileType.ROAD, folder.path
        )

        # Recurse for subfolder
        current_z = layout_folder(
            subfolder, dims, subfolder_x, current_z,
            grid, buildings, streets
        )

    return current_z

def generate_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Main entry point. O(n) total complexity."""

    # Build folder tree from files
    root = build_folder_tree(files)

    # Phase 1: Calculate all dimensions (bottom-up)
    dims = {}
    calculate_all_dimensions(root, dims)

    # Phase 2: Place all elements (top-down)
    grid = {}
    buildings = {}
    streets = {}

    # Place main street (vertical)
    main_street_x = 0
    final_z = layout_folder(root, dims, main_street_x, 0, grid, buildings, streets)

    # Add main street tiles
    for z in range(final_z):
        if (main_street_x, z) not in grid:
            grid[(main_street_x, z)] = Tile(
                main_street_x, z, TileType.ROAD, ""
            )

    # Calculate bounds
    all_x = [pos[0] for pos in grid.keys()]
    all_z = [pos[1] for pos in grid.keys()]
    bounds = (min(all_x), min(all_z), max(all_x), max(all_z))

    return City(
        grid=grid,
        buildings=buildings,
        streets=streets,
        repo_path=repo_path,
        bounds=bounds
    )
```

### Complexity Analysis

| Phase                | Complexity | Reason                             |
| -------------------- | ---------- | ---------------------------------- |
| Calculate dimensions | O(n)       | Visit each folder once, bottom-up  |
| Place elements       | O(n)       | Visit each folder once, top-down   |
| Total                | O(n)       | Linear in number of files/folders  |


### Why This Avoids Sprawl

1. **No collision resolution**: Dimensions are exact, so placement is deterministic
2. **Tight packing**: Files pack in rows of 2, subfolders stack directly
3. **Minimal roads**: Only one road segment per folder, plus main street
4. **No gaps**: Each strip uses exactly its calculated height

## Rendering Changes

### Frontend Updates

Update `city-renderer.js` to handle tile-based rendering:

```javascript
renderCity(cityData) {
    this.clear();

    // Render ground plane sized to bounds
    this.renderGround(cityData.bounds);

    // Render each tile
    for (const [coords, tile] of Object.entries(cityData.grid)) {
        const [x, z] = coords.split(',').map(Number);
        this.renderTile(x, z, tile);
    }

    // Render buildings with full detail
    for (const building of Object.values(cityData.buildings)) {
        this.renderBuilding(building);
    }
}

renderTile(x, z, tile) {
    switch (tile.tile_type) {
        case 'road':
        case 'intersection':
            this.renderRoadTile(x, z, tile);
            break;
        case 'road_start':
            this.renderRoadStart(x, z, tile);
            break;
        case 'road_end':
            this.renderRoadEnd(x, z, tile);
            break;
    }
}
```

### Road Rendering

Roads are flat dark tiles at y=0.1:

```javascript
renderRoadTile(x, z, tile) {
    const mesh = BABYLON.MeshBuilder.CreateBox(
        `road_${x}_${z}`,
        { width: TILE_SIZE, height: 0.1, depth: TILE_SIZE },
        this.scene
    );
    mesh.position.set(
        x * TILE_SIZE + TILE_SIZE/2,
        0.05,
        z * TILE_SIZE + TILE_SIZE/2
    );

    const material = new BABYLON.StandardMaterial(`roadMat_${x}_${z}`, this.scene);
    material.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.17);
    mesh.material = material;
}
```

### Building Placement

Buildings sit adjacent to road tiles:

```javascript
renderBuilding(building) {
    // building.x and building.z are grid coordinates
    // building.road_side is 1 (positive) or -1 (negative)

    const worldX = building.x * TILE_SIZE + TILE_SIZE/2;
    const worldZ = building.z * TILE_SIZE + TILE_SIZE/2;

    // Offset from road based on which side
    const offset = building.road_side * (TILE_SIZE/2 + building.width/2);

    // Apply offset based on road direction
    if (building.road_direction === 'horizontal') {
        worldZ += offset;
    } else {
        worldX += offset;
    }

    // Create building mesh at calculated position
    // ... existing building rendering code
}
```

## API Response Format

```json
{
  "repo_path": "/path/to/repo",
  "bounds": { "min_x": 0, "min_z": -5, "max_x": 20, "max_z": 15 },
  "grid": {
    "0,0": { "type": "road_start", "path": "", "parent": null },
    "1,0": { "type": "road", "path": "", "parent": null },
    "2,0": { "type": "intersection", "path": "", "parent": null },
    "2,1": { "type": "road", "path": "src", "parent": "" },
    "2,2": { "type": "road_end", "path": "src", "parent": "" }
  },
  "buildings": {
    "src/main.py": {
      "file_path": "src/main.py",
      "x": 2, "z": 1,
      "road_side": 1,
      "road_direction": "vertical",
      "height": 45,
      "width": 8,
      "language": "python",
      "created_at": "2024-01-01T00:00:00Z",
      "last_modified": "2024-06-15T12:00:00Z"
    }
  },
  "streets": {
    "": { "name": "root", "start": [0,0], "end": [10,0], "direction": "horizontal" },
    "src": { "name": "src", "start": [2,0], "end": [2,5], "direction": "vertical" }
  }
}
```

## Compactness Optimizations

The strip packing algorithm inherently produces compact layouts, but these additional optimizations maximize density:


### 1. Pack Files Tightly

Files on the same side of the road share edges (no gaps):

```
┌───┬───┬───┐       Not:    ┌───┐ ┌───┐ ┌───┐
│ a │ b │ c │               │ a │ │ b │ │ c │
└───┴───┴───┘               └───┘ └───┘ └───┘
```


### 2. Dual-Side Packing

Files alternate between sides of the road, halving road length:

```
6 files single-side:     6 files dual-side:

┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐  ┌─┬─┬─┐
│a│ │b│ │c│ │d│ │e│ │f│  │a│c│e│
└┬┘ └┬┘ └┬┘ └┬┘ └┬┘ └┬┘  └┬┴┬┴┬┘
 ════════════════════     ═══════
                          ┌┴┬┴┬┴┐
Road length: 6            │b│d│f│
                          └─┴─┴─┘

                         Road length: 3
```


### 3. Sort Subfolders by Size

Place larger subfolders (by total descendant count) first. Since they need more width,
placing them first means smaller subfolders fit in the remaining space without
extending the parent's width:

```python
folder.subfolders.sort(key=lambda sf: -count_descendants(sf))
```


### 4. Indent Subfolders Minimally

Each nesting level indents by exactly 1 tile (for the connecting road segment).
Deep nesting doesn't waste horizontal space:

```text
║
╠═══════════════════ src (wide, many files)
║ ║
║ ╠════════ api (medium)
║ ║ ║
║ ║ ╠═══ v1 (small)
║ ║ ║
```

## Testing Strategy

### Unit Tests

1. **Street length calculation**: Verify formula for various file/subfolder counts
2. **Grid placement**: Test tile placement for simple structures
3. **Collision detection**: Verify overlaps are detected
4. **Collision resolution**: Verify branches slide to valid positions
5. **Compaction**: Verify empty space is removed

### Integration Tests

1. **Round-trip**: Directory → Layout → JSON → Render → verify positions
2. **Real repos**: Test against actual codebases of varying sizes
3. **Edge cases**: Empty folders, deeply nested, single file

### Visual Tests

1. **Connectivity**: Every building should be reachable from root via roads
2. **No overlaps**: Buildings and roads should not overlap
3. **Compactness**: Compare total area to sum of building areas

## Migration Path

1. Add new `grid_layout.py` alongside existing `layout.py`
2. Add feature flag to switch between layouts
3. Update frontend to handle both formats
4. Test with real repos
5. Remove old layout once stable

## Files to Modify

| File | Changes |
|------|---------|
| `src/codecity/analysis/layout.py` | Rewrite with grid-based algorithm |
| `src/codecity/analysis/models.py` | Add Tile, TileType, update City |
| `src/codecity/app/city-renderer.js` | Add tile rendering, update building placement |
| `src/codecity/api/routes.py` | Update response format |

## Open Questions

1. **Building sizing**: Should buildings scale to fit grid cells, or overflow?
   - Recommendation: Scale to fit, with minimum/maximum sizes

2. **Signposts**: Keep folder name signposts? Where to place them?
   - Recommendation: Place at road_start tiles, pointing down the street

3. **Ground plane**: Render empty tiles or just roads/buildings?
   - Recommendation: Subtle ground only under districts, roads clearly visible


## References

Layout algorithm design informed by research on rectangle packing and treemap visualization:

- [Exploring Rectangle Packing Algorithms](https://www.david-colson.com/2020/03/10/exploring-rect-packing.html) -
  Comparison of Skyline, Naive Row Packing, and other algorithms with performance benchmarks

- [Squarified Treemaps (van Wijk et al.)](https://vanwijk.win.tue.nl/stm.pdf) -
  Original paper on squarified treemap algorithm for space-efficient hierarchical visualization

- [Treemapping - Wikipedia](https://en.wikipedia.org/wiki/Treemapping) -
  Overview of treemap variants including slice-and-dice, squarified, and ordered approaches

- [Hierarchical Data Visualization Using a Fast Rectangle-Packing Algorithm][ieee-rect] -
  IEEE paper on bottom-up rectangle packing for nested hierarchical data

- [CodeCity: 3D Visualization of Large-Scale Software][codecity-paper] -
  Research on the city metaphor for code visualization, using containment-based layouts

- [Tree-Maps: A Space-Filling Approach (Shneiderman)][treemaps-original] -
  Original treemap paper establishing the space-filling visualization technique

[ieee-rect]: https://ieeexplore.ieee.org/document/1272729/
[codecity-paper]: https://www.researchgate.net/publication/221555855
[treemaps-original]: https://www.cs.umd.edu/~ben/papers/Johnson1991Tree.pdf
