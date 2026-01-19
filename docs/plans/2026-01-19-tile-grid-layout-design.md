# Tile Grid Layout Algorithm - Design

## Problem

The current layout algorithm calculates folder positions mathematically based on local information, but doesn't track global space usage. This causes roads from unrelated folders to intersect (e.g., `analysis/tests` road passing through `src/` road).

![Screenshot showing tests road intersecting src road](../../screenshots/2026-01-18-intersection-bug.png)

## Solution Overview

Replace the recursive position calculation with a **tile-based reservation system**:

1. Maintain a 2D grid where each cell represents a coordinate region
2. Before placing any element, check if target cells are available
3. Mark cells as occupied after placement
4. Use BFS to find free space when preferred location is blocked
5. Connect disconnected placements with L-shaped road connectors

## Design Goals

| Goal | Description |
|------|-------------|
| Collision-free | Buildings never overlap buildings or roads; roads only cross at valid intersections |
| Compact | Downtown grid feel - efficient space usage, no sprawl |
| Neighborhood clustering | Related folders stay near their parents when possible |
| Manhattan grid aesthetic | L-shaped connectors, orthogonal roads |

## Grid Structure

### Cell Properties

```python
CELL_SIZE = 6.0  # MIN_BUILDING_WIDTH - allows fine-grained packing

@dataclass
class TileContent:
    type: Literal["road", "building", "reserved"]
    owner_path: str   # e.g., "src/analysis" - which folder owns this cell
    depth: int        # folder nesting level (0 = root)

@dataclass
class TileGrid:
    cell_size: float = CELL_SIZE
    cells: dict[tuple[int, int], TileContent]  # (grid_x, grid_y) -> content
```

### Coordinate Conversion

Grid position maps directly to world coordinates:

```python
def grid_to_world(grid_x: int, grid_y: int) -> tuple[float, float]:
    return (grid_x * CELL_SIZE, grid_y * CELL_SIZE)

def world_to_grid(x: float, y: float) -> tuple[int, int]:
    return (int(x // CELL_SIZE), int(y // CELL_SIZE))
```

No post-processing layer - grid cells ARE coordinate regions.

## Collision Rules

### Building Placement

Buildings **never** overlap anything:

```python
def can_place_building(self, grid_pos: tuple[int, int]) -> bool:
    return grid_pos not in self.cells  # must be empty
```

### Road Placement

Roads can cross other roads **only** if they are direct parent↔child:

```python
def can_place_road(
    self,
    grid_pos: tuple[int, int],
    new_path: str,
    new_depth: int
) -> bool:
    existing = self.cells.get(grid_pos)

    if existing is None:
        return True  # empty cell

    if existing.type == "road":
        # Allow intersection only between adjacent depths
        # (direct parent-child relationship)
        return abs(existing.depth - new_depth) == 1

    return False  # building or reserved - never overlap
```

**Examples:**
- `src/` (depth 1) crossing `codecity/` (depth 0): ✓ allowed
- `src/analysis/` (depth 2) crossing `src/` (depth 1): ✓ allowed
- `src/analysis/tests/` (depth 3) crossing `src/` (depth 1): ✗ blocked (depth diff = 2)

## Placement Algorithm

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Calculate space needed for folder (buildings + subfolders)│
├─────────────────────────────────────────────────────────────┤
│ 2. BFS from parent road endpoint to find free region        │
├─────────────────────────────────────────────────────────────┤
│ 3. Reserve tiles for buildings and road                      │
├─────────────────────────────────────────────────────────────┤
│ 4. Connect to parent with L-shaped road connector            │
├─────────────────────────────────────────────────────────────┤
│ 5. Recursively place subfolders                              │
└─────────────────────────────────────────────────────────────┘
```

### BFS Region Finding

```python
def find_free_region(
    self,
    start_pos: tuple[int, int],
    required_width: int,   # in grid cells
    required_height: int,  # in grid cells
    folder_path: str,
    depth: int,
) -> tuple[int, int] | None:
    """
    BFS outward from start_pos to find a contiguous free region.
    Returns top-left corner of found region, or None if impossible.
    """
    visited = set()
    queue = deque([start_pos])

    while queue:
        pos = queue.popleft()
        if pos in visited:
            continue
        visited.add(pos)

        # Check if region starting at pos is free
        if self._region_is_free(pos, required_width, required_height, depth):
            return pos

        # Expand search in 4 directions
        for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            next_pos = (pos[0] + dx, pos[1] + dy)
            if next_pos not in visited:
                queue.append(next_pos)

    return None  # no space found (shouldn't happen in practice)
```

### L-Shaped Road Connectors

When a folder is placed away from its parent, connect with an L-shaped road:

```
Parent road endpoint: P
Folder placement: F

Option 1: Horizontal then vertical
    P ────┐
          │
          F

Option 2: Vertical then horizontal
    P
    │
    └──── F
```

Choose the option that requires fewer occupied-cell crossings:

```python
def create_l_connector(
    self,
    start: tuple[int, int],
    end: tuple[int, int],
    depth: int,
) -> list[tuple[int, int]]:
    """
    Create L-shaped path from start to end.
    Returns list of grid cells for the road.
    """
    # Try horizontal-first
    path_h = self._h_then_v_path(start, end)
    cost_h = self._path_crossing_cost(path_h, depth)

    # Try vertical-first
    path_v = self._v_then_h_path(start, end)
    cost_v = self._path_crossing_cost(path_v, depth)

    return path_h if cost_h <= cost_v else path_v
```

## Layout Flow

### Main Entry Point

```python
def layout(self, file_metrics: dict[str, FileMetrics], root_name: str) -> dict:
    grid = TileGrid()

    # 1. Build folder tree
    tree = build_tree(file_metrics)

    # 2. Place main street at origin
    main_street_cells = place_main_street(grid, root_name, tree, file_metrics)

    # 3. Place top-level folders via BFS
    for folder_name in tree.keys():
        place_folder_bfs(
            grid=grid,
            tree=tree[folder_name],
            folder_path=folder_name,
            file_metrics=file_metrics,
            depth=1,
            parent_endpoint=main_street_end,
        )

    # 4. Convert grid to GeoJSON
    return grid_to_geojson(grid)
```

### Folder Placement

```python
def place_folder_bfs(
    grid: TileGrid,
    tree: dict,
    folder_path: str,
    file_metrics: dict,
    depth: int,
    parent_endpoint: tuple[int, int],
) -> tuple[int, int]:  # returns this folder's endpoint for children

    # Calculate space needed
    files = get_files_in_folder(folder_path, file_metrics)
    width, height = calculate_folder_dimensions(files, tree)

    # BFS to find free region
    placement = grid.find_free_region(
        start_pos=parent_endpoint,
        required_width=width,
        required_height=height,
        folder_path=folder_path,
        depth=depth,
    )

    # Reserve the region
    grid.reserve_region(placement, width, height, folder_path, depth)

    # Connect to parent with L-shaped road
    connector_cells = grid.create_l_connector(parent_endpoint, placement, depth)
    grid.place_road(connector_cells, folder_path, depth)

    # Place buildings along the folder's street
    street_end = place_buildings(grid, placement, files, folder_path, depth)

    # Recursively place subfolders
    for subfolder_name in tree.keys():
        place_folder_bfs(
            grid=grid,
            tree=tree[subfolder_name],
            folder_path=f"{folder_path}/{subfolder_name}",
            file_metrics=file_metrics,
            depth=depth + 1,
            parent_endpoint=street_end,
        )

    return street_end
```

## Building Placement Within Folders

Buildings are placed along both sides of the folder's street:

```
Street runs horizontally:

    [B1] [B3] [B5]
    ═══════════════  ← street
    [B2] [B4] [B6]

Buildings alternate sides, placed sequentially along the street.
```

```python
def place_buildings(
    grid: TileGrid,
    street_start: tuple[int, int],
    files: list[tuple[str, FileMetrics]],
    folder_path: str,
    depth: int,
) -> tuple[int, int]:  # returns street endpoint

    street_x, street_y = street_start

    for i, (path, metrics) in enumerate(files):
        side = 1 if i % 2 == 0 else -1  # alternate north/south
        position_along = i // 2

        # Building center in grid coords
        bx = street_x + position_along
        by = street_y + side * 2  # offset from street

        # Calculate building size in cells (based on tier width)
        num_tiers = calculate_num_tiers(metrics.lines_of_code)
        tier_widths = calculate_tier_widths(metrics.line_lengths, num_tiers)
        max_width = max(tier_widths)
        cells_needed = math.ceil(max_width / CELL_SIZE)

        # Reserve cells for building footprint
        for dx in range(cells_needed):
            for dy in range(cells_needed):
                grid.cells[(bx + dx, by + dy)] = TileContent(
                    type="building",
                    owner_path=path,
                    depth=depth,
                )

    # Street endpoint
    street_length = (len(files) + 1) // 2
    return (street_x + street_length, street_y)
```

## Edge Cases

### No Free Space Found

In practice, BFS will always find space (grid is unbounded). But if we want bounded cities:

```python
def find_free_region(..., max_search_radius: int = 100):
    # ... BFS with distance limit ...
    if search_radius > max_search_radius:
        raise LayoutError(f"Cannot place {folder_path}: no space within radius")
```

### Very Deep Nesting

Deeply nested folders may end up far from root. This is acceptable - it reflects the actual structure. The BFS naturally pushes deep folders outward.

### Empty Folders

Folders with no files but with subfolders still get a street (just shorter). The street exists to connect children.

## Performance Considerations

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Grid lookup | O(1) | Dict-based cells |
| BFS region finding | O(n) | n = cells searched before finding space |
| L-connector pathfinding | O(d) | d = Manhattan distance |
| Total layout | O(f * a) | f = folders, a = avg cells searched |

For typical codebases (< 10k files), this should complete in < 1 second.

## Migration Path

1. Implement `TileGrid` class alongside existing `GeoJSONLayoutEngine`
2. Create new `TileGridLayoutEngine` using the grid
3. Add config flag to switch between algorithms
4. Test extensively with real codebases
5. Make tile grid the default once stable
6. Remove old algorithm

## Testing Strategy

### Unit Tests

- `test_can_place_building_empty_cell` - building in empty cell succeeds
- `test_can_place_building_occupied_cell` - building in occupied cell fails
- `test_can_place_road_parent_child_crossing` - adjacent depth roads can cross
- `test_can_place_road_grandchild_blocked` - non-adjacent depth roads blocked
- `test_find_free_region_immediate` - finds space at start position
- `test_find_free_region_offset` - finds space when start blocked
- `test_l_connector_horizontal_first` - correct path when h-first is better
- `test_l_connector_vertical_first` - correct path when v-first is better

### Integration Tests

- `test_layout_no_intersections` - full layout produces no invalid crossings
- `test_layout_codecity_repo` - layout this repo, verify tests/src don't cross
- `test_layout_compactness` - bounding box is reasonably tight

### Visual Regression

- Render before/after screenshots for manual comparison
- Ensure city "looks right" beyond just collision-free
