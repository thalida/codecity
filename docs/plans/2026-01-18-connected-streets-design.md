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

Rendered city (buildings line the same road as subfolder branches):

              ┌────────┐
              │ README │
              └───┬────┘
         ║        │
    root ╠════════╧═══╤════════════╤════════════════════════════
         ║            │            │
         ║       ┌────┴─────┐      │       ┌────────┬────────┐
         ║       │ test_main│      │       │ server │ routes │
         ║       └────┬─────┘      │       └───┬────┴────┬───┘
         ║            │            │           │         │
   tests ╠════════════╧════   src  ╠═══════════╧═════════╧═══╤═══════════
         ║                         ║                         │
         ║                         ║    ┌──────┬───────┬─────┴──┐
         ║                         ║    │ main │ utils │ config │
         ║                         ║    └──────┴───────┴────────┘
         ║                         ║
         ▼                     api ╠════════════════════════════
                                   ║
                                   ▼
```

Key features:

- Main street runs vertically (║), each folder branches horizontally (═)
- Buildings AND subfolders both connect to the same street
- Files and subfolders can be placed on either side (+z or -z) for optimal compactness
- Walking the road takes you past both buildings and intersections to child folders

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


### Phase 1: Calculate Dimensions (Bottom-Up)

Process the tree from leaves to root. Calculate street length and the depth
required on each side (+z and -z) to determine optimal placement:

```python
@dataclass
class StreetDimensions:
    """Dimensions needed for a folder's street."""
    length: int       # Road segments needed
    depth_pos: int    # Max depth of elements on +z side
    depth_neg: int    # Max depth of elements on -z side

def calculate_dimensions(folder: Folder) -> StreetDimensions:
    """Calculate dimensions bottom-up. O(n) - visits each node once."""

    # Street length = max(file count, subfolder count)
    # Files and subfolders can go on either side
    street_length = max(len(folder.files), len(folder.subfolders), 1)

    if not folder.subfolders:
        # Leaf folder: files can go on either side, depth = 1
        return StreetDimensions(length=street_length, depth_pos=1, depth_neg=1)

    # Recursive case: get dimensions from subfolders
    subfolder_dims = [calculate_dimensions(sf) for sf in folder.subfolders]

    # Each subfolder's total depth = max(its pos depth, its neg depth) + 1 for connector
    subfolder_depths = [max(d.depth_pos, d.depth_neg) + 1 for d in subfolder_dims]
    max_subfolder_depth = max(subfolder_depths)

    return StreetDimensions(
        length=street_length,
        depth_pos=max_subfolder_depth,  # Either side can hold subfolders
        depth_neg=max_subfolder_depth
    )
```


### Phase 2: Place Elements (Top-Down)

Files and subfolder branches share the same street. The algorithm picks which side
(+z or -z) to place each element to minimize total depth:

```python
def layout_folder(
    folder: Folder,
    start_x: int,
    start_z: int,
    parent_side: int,  # Which side we branched from parent (+1 or -1)
    grid: dict,
    buildings: dict,
    streets: dict
) -> tuple[int, int]:
    """
    Layout a folder's street with files and subfolders along the same road.
    Returns (max_z_positive, min_z_negative) bounds used by this folder.
    """
    street_length = max(len(folder.files), len(folder.subfolders), 1)
    current_x = start_x

    # Track depth used on each side
    max_z_pos = start_z
    min_z_neg = start_z

    # 1. Place intersection tile at start
    grid[(current_x, start_z)] = Tile(current_x, start_z, TileType.INTERSECTION, folder.path)
    current_x += 1

    # 2. Interleave files and subfolders, placing on alternating sides
    #    This balances depth on both sides of the road
    items = []
    for f in folder.files:
        items.append(('file', f))
    for sf in folder.subfolders:
        items.append(('subfolder', sf))

    # Sort: place subfolders first (they need more depth), alternate sides
    items.sort(key=lambda x: (0 if x[0] == 'subfolder' else 1))

    # Assign sides: alternate to balance, but prefer opposite of parent_side for first subfolder
    side_preference = -parent_side  # Start opposite to how we branched in
    assigned = []
    for item in items:
        assigned.append((item, side_preference))
        side_preference *= -1  # Alternate

    # 3. Place road tiles and elements
    for i in range(street_length):
        road_x = current_x + i
        grid[(road_x, start_z)] = Tile(road_x, start_z, TileType.ROAD, folder.path)

    # Place each element at its position
    file_idx = 0
    subfolder_idx = 0
    for (item_type, item), side in assigned:
        if item_type == 'file':
            road_x = current_x + file_idx
            if road_x < current_x + street_length:
                building = Building.from_metrics(item)
                building.grid_x = road_x
                building.grid_z = start_z
                building.road_side = side
                buildings[item.path] = building

                if side > 0:
                    max_z_pos = max(max_z_pos, start_z + 1)
                else:
                    min_z_neg = min(min_z_neg, start_z - 1)
            file_idx += 1

        else:  # subfolder
            road_x = current_x + subfolder_idx
            if road_x < current_x + street_length:
                connector_z = start_z + side  # Branch in 'side' direction
                grid[(road_x, connector_z)] = Tile(
                    road_x, connector_z, TileType.ROAD, item.path
                )

                # Recurse
                sub_max, sub_min = layout_folder(
                    item, road_x, connector_z, side,
                    grid, buildings, streets
                )
                max_z_pos = max(max_z_pos, sub_max)
                min_z_neg = min(min_z_neg, sub_min)
            subfolder_idx += 1

    # Record street metadata
    streets[folder.path] = Street(
        path=folder.path,
        name=folder.name,
        start=(start_x, start_z),
        end=(current_x + street_length - 1, start_z),
        direction=Direction.HORIZONTAL
    )

    return max_z_pos, min_z_neg


def generate_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Main entry point. O(n) total complexity."""

    # Build folder tree from files
    root = build_folder_tree(files)

    # Place all elements starting from root
    grid = {}
    buildings = {}
    streets = {}

    # Root street starts at origin, extends in +x direction
    # Elements branch to both +z and -z sides for balance
    layout_folder(
        root,
        start_x=0,
        start_z=0,
        parent_side=1,  # Arbitrary for root
        grid=grid,
        buildings=buildings,
        streets=streets
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

| Phase          | Complexity | Reason                            |
| -------------- | ---------- | --------------------------------- |
| Place elements | O(n)       | Visit each folder once, top-down  |
| Total          | O(n)       | Linear in number of files/folders |


### Why This Avoids Sprawl

1. **Shared road**: Files and subfolders use the same street, no separate rows
2. **No collision resolution**: Subfolders branch downward, no horizontal overlap
3. **Minimal roads**: One road per folder, length = max(files, subfolders)
4. **Compact depth**: Tree depth translates directly to z-depth, no wasted space

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

The shared-road layout with flexible side placement produces compact cities:


### 1. Files and Subfolders Share the Road

Each road segment can have elements on BOTH sides:

```text
         ┌─────┐     ┌─────┐
         │  a  │     │  c  │     <- some elements on +z
         └──┬──┘     └──┬──┘
    ════════╧═════╤═════╧═════   <- shared road
                  │
                 sub1            <- some elements on -z
```

Road length = max(file_count, subfolder_count), not the sum.


### 2. Alternating Side Placement

Elements alternate sides to balance depth on both +z and -z:

```text
Unbalanced (all on one side):     Balanced (alternating):

         ┌─┬─┬─┐                       ┌─┐   ┌─┐
         │a│b│c│                       │a│   │c│
         └┬┴┬┴┬┘                       └┬┘   └┬┘
    ══════╧═╧═╧══════             ══════╧══╤══╧════
          │ │ │                            │
         s1 s2 s3                          │b│
                                           └─┘

Total depth: 4                    Total depth: 2
```


### 3. Pack Files Tightly

Files on the same side of the road share edges (no gaps):

```text
┌───┬───┬───┐       Not:    ┌───┐ ┌───┐ ┌───┐
│ a │ b │ c │               │ a │ │ b │ │ c │
└───┴───┴───┘               └───┘ └───┘ └───┘
```


### 4. Opposite-Side Branching

When a folder branches from its parent, its children prefer the opposite side.
This prevents all elements stacking in one direction:

```text
Parent branches down (-z), so children prefer up (+z):

    parent ════════╤════════
                   │
           child ══╧══╤══════
                      │
              ┌───────┴───────┐
              │ grandchildren │  <- goes +z (opposite of child's branch)
              └───────────────┘
```


## Testing Strategy

### Unit Tests

1. **Street length calculation**: Verify max(files, subfolders) formula
2. **Grid placement**: Test tile placement for simple structures
3. **Building positions**: Verify files are on +z side of their road
4. **Subfolder branching**: Verify subfolders connect at -z side

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
