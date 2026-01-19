# Tile Grid Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current recursive layout algorithm with a tile-based reservation system that prevents road/building collisions.

**Architecture:** A 2D grid tracks occupied cells. Folders are placed via BFS from parent endpoints, reserving tiles before placement. Roads connect via L-shaped paths and can only cross at adjacent depths (parent↔child).

**Tech Stack:** Python dataclasses, existing GeoJSON models, pytest for TDD.

---

## Task 1: TileContent and TileGrid Data Structures

**Files:**
- Create: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing test for TileContent**

```python
# src/codecity/analysis/tests/test_tile_grid.py
from codecity.analysis.tile_grid import TileContent


def test_tile_content_creation():
    content = TileContent(
        type="road",
        owner_path="src/analysis",
        depth=2,
    )
    assert content.type == "road"
    assert content.owner_path == "src/analysis"
    assert content.depth == 2
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py::test_tile_content_creation -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'codecity.analysis.tile_grid'"

**Step 3: Write minimal implementation**

```python
# src/codecity/analysis/tile_grid.py
"""Tile-based grid for collision-free city layout.

This module implements a 2D reservation system where each cell
represents a coordinate region. Elements are placed by checking
availability first, preventing overlaps.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass
class TileContent:
    """Content occupying a grid cell."""

    type: Literal["road", "building", "reserved"]
    owner_path: str  # e.g., "src/analysis" - which folder/file owns this cell
    depth: int  # folder nesting level (0 = root)
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py::test_tile_content_creation -v`
Expected: PASS

**Step 5: Write the failing test for TileGrid**

```python
def test_tile_grid_creation():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid(cell_size=6.0)
    assert grid.cell_size == 6.0
    assert grid.cells == {}
```

**Step 6: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py::test_tile_grid_creation -v`
Expected: FAIL with "cannot import name 'TileGrid'"

**Step 7: Add TileGrid implementation**

```python
# Add to src/codecity/analysis/tile_grid.py
from dataclasses import field


@dataclass
class TileGrid:
    """2D grid for tracking occupied space."""

    cell_size: float = 6.0  # MIN_BUILDING_WIDTH
    cells: dict[tuple[int, int], TileContent] = field(default_factory=dict)
```

**Step 8: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py::test_tile_grid_creation -v`
Expected: PASS

**Step 9: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add TileContent and TileGrid data structures

Foundation for tile-based collision-free layout algorithm.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Coordinate Conversion Functions

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing tests**

```python
def test_grid_to_world():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid(cell_size=6.0)
    x, y = grid.grid_to_world(2, 3)
    assert x == 12.0  # 2 * 6.0
    assert y == 18.0  # 3 * 6.0


def test_world_to_grid():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid(cell_size=6.0)
    gx, gy = grid.world_to_grid(14.0, 20.0)
    assert gx == 2  # int(14.0 // 6.0)
    assert gy == 3  # int(20.0 // 6.0)
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py::test_grid_to_world src/codecity/analysis/tests/test_tile_grid.py::test_world_to_grid -v`
Expected: FAIL with "AttributeError: 'TileGrid' object has no attribute 'grid_to_world'"

**Step 3: Add coordinate conversion methods to TileGrid**

```python
# Add methods to TileGrid class
def grid_to_world(self, grid_x: int, grid_y: int) -> tuple[float, float]:
    """Convert grid position to world coordinates."""
    return (grid_x * self.cell_size, grid_y * self.cell_size)

def world_to_grid(self, x: float, y: float) -> tuple[int, int]:
    """Convert world coordinates to grid position."""
    return (int(x // self.cell_size), int(y // self.cell_size))
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py::test_grid_to_world src/codecity/analysis/tests/test_tile_grid.py::test_world_to_grid -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add coordinate conversion methods to TileGrid

grid_to_world and world_to_grid for translating between grid cells
and world coordinates.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Building Placement Collision Check

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing tests**

```python
def test_can_place_building_empty_cell():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    assert grid.can_place_building((0, 0)) is True


def test_can_place_building_occupied_by_building():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="building", owner_path="src/main.py", depth=1)
    assert grid.can_place_building((0, 0)) is False


def test_can_place_building_occupied_by_road():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="src", depth=1)
    assert grid.can_place_building((0, 0)) is False
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "can_place_building" -v`
Expected: FAIL with "AttributeError: 'TileGrid' object has no attribute 'can_place_building'"

**Step 3: Add can_place_building method**

```python
# Add method to TileGrid class
def can_place_building(self, grid_pos: tuple[int, int]) -> bool:
    """Check if a building can be placed at this grid position.

    Buildings can only be placed in empty cells - they never overlap anything.
    """
    return grid_pos not in self.cells
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "can_place_building" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add can_place_building collision check

Buildings can only be placed in empty cells.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Road Placement Collision Check

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing tests**

```python
def test_can_place_road_empty_cell():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    assert grid.can_place_road((0, 0), "src", depth=1) is True


def test_can_place_road_occupied_by_building():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="building", owner_path="src/main.py", depth=1)
    assert grid.can_place_road((0, 0), "src", depth=1) is False


def test_can_place_road_parent_child_crossing():
    """Roads at adjacent depths can cross (parent-child relationship)."""
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    # Root road at depth 0
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="root", depth=0)
    # Child road at depth 1 can cross
    assert grid.can_place_road((0, 0), "src", depth=1) is True


def test_can_place_road_grandchild_blocked():
    """Roads at non-adjacent depths cannot cross."""
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    # Root road at depth 0
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="root", depth=0)
    # Grandchild road at depth 2 cannot cross (depth diff = 2)
    assert grid.can_place_road((0, 0), "src/analysis/tests", depth=2) is False


def test_can_place_road_same_depth_blocked():
    """Roads at the same depth cannot cross."""
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="src", depth=1)
    # Another depth-1 road cannot cross
    assert grid.can_place_road((0, 0), "lib", depth=1) is False
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "can_place_road" -v`
Expected: FAIL with "AttributeError: 'TileGrid' object has no attribute 'can_place_road'"

**Step 3: Add can_place_road method**

```python
# Add method to TileGrid class
def can_place_road(self, grid_pos: tuple[int, int], path: str, depth: int) -> bool:
    """Check if a road can be placed at this grid position.

    Roads can be placed in empty cells, or can cross existing roads
    only if they have adjacent depths (parent-child relationship).
    """
    existing = self.cells.get(grid_pos)

    if existing is None:
        return True  # empty cell

    if existing.type == "road":
        # Allow intersection only between adjacent depths
        return abs(existing.depth - depth) == 1

    return False  # building or reserved - never overlap
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "can_place_road" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add can_place_road with depth-based crossing rules

Roads can cross other roads only at adjacent depths (parent-child).
This prevents deep descendants from crossing through ancestor roads.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Place Building Method

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing tests**

```python
def test_place_building_single_cell():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    result = grid.place_building((0, 0), "src/main.py", depth=1)

    assert result is True
    assert (0, 0) in grid.cells
    assert grid.cells[(0, 0)].type == "building"
    assert grid.cells[(0, 0)].owner_path == "src/main.py"


def test_place_building_multi_cell():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    result = grid.place_building((0, 0), "src/main.py", depth=1, width=2, height=2)

    assert result is True
    # Should occupy 4 cells
    assert (0, 0) in grid.cells
    assert (1, 0) in grid.cells
    assert (0, 1) in grid.cells
    assert (1, 1) in grid.cells


def test_place_building_blocked():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="src", depth=1)

    result = grid.place_building((0, 0), "src/main.py", depth=1)
    assert result is False
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "place_building" -v`
Expected: FAIL with "AttributeError: 'TileGrid' object has no attribute 'place_building'"

**Step 3: Add place_building method**

```python
# Add method to TileGrid class
def place_building(
    self,
    grid_pos: tuple[int, int],
    path: str,
    depth: int,
    width: int = 1,
    height: int = 1,
) -> bool:
    """Place a building occupying width x height cells starting at grid_pos.

    Returns True if placement succeeded, False if blocked.
    """
    gx, gy = grid_pos

    # Check all cells first
    for dx in range(width):
        for dy in range(height):
            if not self.can_place_building((gx + dx, gy + dy)):
                return False

    # Place in all cells
    for dx in range(width):
        for dy in range(height):
            self.cells[(gx + dx, gy + dy)] = TileContent(
                type="building",
                owner_path=path,
                depth=depth,
            )

    return True
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "place_building" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add place_building method for reserving grid cells

Supports multi-cell buildings with width x height footprint.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Place Road Method

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing tests**

```python
def test_place_road_cells():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    cells = [(0, 0), (1, 0), (2, 0)]
    result = grid.place_road(cells, "src", depth=1)

    assert result is True
    for cell in cells:
        assert cell in grid.cells
        assert grid.cells[cell].type == "road"


def test_place_road_blocked_by_building():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    grid.cells[(1, 0)] = TileContent(type="building", owner_path="src/main.py", depth=1)

    cells = [(0, 0), (1, 0), (2, 0)]
    result = grid.place_road(cells, "src", depth=1)

    assert result is False
    # Original cells should not be modified
    assert (0, 0) not in grid.cells
    assert (2, 0) not in grid.cells


def test_place_road_crossing_allowed():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    # Place parent road at depth 0
    grid.cells[(1, 0)] = TileContent(type="road", owner_path="root", depth=0)

    # Child road at depth 1 should be able to cross
    cells = [(1, -1), (1, 0), (1, 1)]
    result = grid.place_road(cells, "src", depth=1)

    assert result is True
    # The crossing cell now has the child road (overwrites)
    assert grid.cells[(1, 0)].owner_path == "src"
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "place_road" -v`
Expected: FAIL with "AttributeError: 'TileGrid' object has no attribute 'place_road'"

**Step 3: Add place_road method**

```python
# Add method to TileGrid class
def place_road(
    self,
    cells: list[tuple[int, int]],
    path: str,
    depth: int,
) -> bool:
    """Place a road along the given cells.

    Returns True if placement succeeded, False if blocked.
    """
    # Check all cells first
    for cell in cells:
        if not self.can_place_road(cell, path, depth):
            return False

    # Place in all cells
    for cell in cells:
        self.cells[cell] = TileContent(
            type="road",
            owner_path=path,
            depth=depth,
        )

    return True
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "place_road" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add place_road method with crossing support

Roads are placed along a list of cells, respecting depth-based
crossing rules.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: L-Shaped Path Generation

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing tests**

```python
def test_l_path_horizontal_first():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    path = grid.create_l_path((0, 0), (3, 2))

    # Horizontal first: (0,0) -> (3,0) -> (3,2)
    assert (0, 0) in path
    assert (1, 0) in path
    assert (2, 0) in path
    assert (3, 0) in path
    assert (3, 1) in path
    assert (3, 2) in path


def test_l_path_vertical_first():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    path = grid.create_l_path((0, 0), (3, 2), horizontal_first=False)

    # Vertical first: (0,0) -> (0,2) -> (3,2)
    assert (0, 0) in path
    assert (0, 1) in path
    assert (0, 2) in path
    assert (1, 2) in path
    assert (2, 2) in path
    assert (3, 2) in path


def test_l_path_same_row():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    path = grid.create_l_path((0, 0), (3, 0))

    # Straight horizontal line
    assert path == [(0, 0), (1, 0), (2, 0), (3, 0)]


def test_l_path_same_column():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    path = grid.create_l_path((0, 0), (0, 3))

    # Straight vertical line
    assert path == [(0, 0), (0, 1), (0, 2), (0, 3)]


def test_l_path_negative_direction():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    path = grid.create_l_path((3, 3), (0, 0))

    # Should handle negative direction
    assert (3, 3) in path
    assert (0, 0) in path
    assert len(path) == 7  # 4 horizontal + 4 vertical - 1 corner
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "l_path" -v`
Expected: FAIL with "AttributeError: 'TileGrid' object has no attribute 'create_l_path'"

**Step 3: Add create_l_path method**

```python
# Add method to TileGrid class
def create_l_path(
    self,
    start: tuple[int, int],
    end: tuple[int, int],
    horizontal_first: bool = True,
) -> list[tuple[int, int]]:
    """Create an L-shaped path from start to end.

    Args:
        start: Starting grid position
        end: Ending grid position
        horizontal_first: If True, go horizontal then vertical; else vertical then horizontal

    Returns:
        List of grid cells forming the path
    """
    sx, sy = start
    ex, ey = end

    path: list[tuple[int, int]] = []

    if horizontal_first:
        # Horizontal segment
        step_x = 1 if ex >= sx else -1
        for x in range(sx, ex + step_x, step_x):
            path.append((x, sy))
        # Vertical segment (skip the corner, already added)
        step_y = 1 if ey >= sy else -1
        for y in range(sy + step_y, ey + step_y, step_y):
            path.append((ex, y))
    else:
        # Vertical segment
        step_y = 1 if ey >= sy else -1
        for y in range(sy, ey + step_y, step_y):
            path.append((sx, y))
        # Horizontal segment (skip the corner, already added)
        step_x = 1 if ex >= sx else -1
        for x in range(sx + step_x, ex + step_x, step_x):
            path.append((x, ey))

    return path
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "l_path" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add create_l_path for L-shaped road connectors

Generates Manhattan-style paths between grid positions.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: BFS Region Finding

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing tests**

```python
def test_find_free_region_immediate():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    result = grid.find_free_region(
        start_pos=(0, 0),
        width=2,
        height=2,
        depth=1,
    )

    # Should find space at start position
    assert result == (0, 0)


def test_find_free_region_offset():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    # Block the starting area
    grid.cells[(0, 0)] = TileContent(type="building", owner_path="x", depth=1)

    result = grid.find_free_region(
        start_pos=(0, 0),
        width=2,
        height=2,
        depth=1,
    )

    # Should find space nearby but not at (0,0)
    assert result is not None
    assert result != (0, 0)


def test_find_free_region_larger_block():
    from codecity.analysis.tile_grid import TileGrid, TileContent

    grid = TileGrid()
    # Block a 3x3 area
    for x in range(3):
        for y in range(3):
            grid.cells[(x, y)] = TileContent(type="building", owner_path="x", depth=1)

    result = grid.find_free_region(
        start_pos=(0, 0),
        width=2,
        height=2,
        depth=1,
    )

    # Should find space outside the blocked area
    assert result is not None
    rx, ry = result
    # Result should not overlap with blocked area
    assert rx >= 3 or ry >= 3 or rx < 0 or ry < 0
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "find_free_region" -v`
Expected: FAIL with "AttributeError: 'TileGrid' object has no attribute 'find_free_region'"

**Step 3: Add find_free_region method**

```python
# Add import at top of file
from collections import deque

# Add method to TileGrid class
def find_free_region(
    self,
    start_pos: tuple[int, int],
    width: int,
    height: int,
    depth: int,
    max_search_radius: int = 100,
) -> tuple[int, int] | None:
    """BFS outward from start_pos to find a free region of width x height.

    Args:
        start_pos: Starting grid position for search
        width: Required width in grid cells
        height: Required height in grid cells
        depth: Depth of the element being placed (for road crossing checks)
        max_search_radius: Maximum distance to search

    Returns:
        Top-left corner of found region, or None if no space found
    """
    visited: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque([start_pos])

    while queue:
        pos = queue.popleft()
        if pos in visited:
            continue
        visited.add(pos)

        # Check if we've gone too far
        px, py = pos
        sx, sy = start_pos
        if abs(px - sx) > max_search_radius or abs(py - sy) > max_search_radius:
            continue

        # Check if region starting at pos is free
        if self._region_is_free(pos, width, height):
            return pos

        # Expand search in 4 directions
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            next_pos = (pos[0] + dx, pos[1] + dy)
            if next_pos not in visited:
                queue.append(next_pos)

    return None

def _region_is_free(
    self,
    top_left: tuple[int, int],
    width: int,
    height: int,
) -> bool:
    """Check if a rectangular region is completely free."""
    tx, ty = top_left
    for dx in range(width):
        for dy in range(height):
            if not self.can_place_building((tx + dx, ty + dy)):
                return False
    return True
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "find_free_region" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add BFS-based find_free_region method

Searches outward from a starting position to find free space for
buildings/folders.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: TileGridLayoutEngine - Basic Structure

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing test**

```python
def test_tile_grid_layout_engine_creation():
    from codecity.analysis.tile_grid import TileGridLayoutEngine

    engine = TileGridLayoutEngine()
    assert engine.grid is not None
    assert engine.streets == []
    assert engine.buildings == []


def test_tile_grid_layout_engine_layout_returns_geojson():
    from datetime import datetime, timezone

    from codecity.analysis.models import FileMetrics
    from codecity.analysis.tile_grid import TileGridLayoutEngine

    metrics = {
        "src/main.py": FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=datetime.now(timezone.utc),
            last_modified=datetime.now(timezone.utc),
            line_lengths=[40] * 100,
        )
    }

    engine = TileGridLayoutEngine()
    result = engine.layout(metrics)

    assert result["type"] == "FeatureCollection"
    assert "features" in result
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "tile_grid_layout_engine" -v`
Expected: FAIL with "cannot import name 'TileGridLayoutEngine'"

**Step 3: Add TileGridLayoutEngine class**

```python
# Add imports at top
from typing import Any
from pathlib import PurePosixPath

from codecity.analysis.geojson_models import (
    BuildingFeature,
    GeoCoord,
    GrassFeature,
    StreetFeature,
)
from codecity.analysis.models import FileMetrics

# Add after TileGrid class
@dataclass
class TileGridLayoutEngine:
    """Layout engine using tile-based collision detection.

    This engine uses a grid reservation system to ensure no overlapping
    elements. Folders are placed via BFS from parent endpoints, and roads
    connect via L-shaped paths.
    """

    grid: TileGrid = field(default_factory=TileGrid)
    streets: list[StreetFeature] = field(default_factory=list)
    buildings: list[BuildingFeature] = field(default_factory=list)
    grass: GrassFeature | None = field(default=None)
    _root_name: str = field(default="root")

    def layout(
        self,
        file_metrics: dict[str, FileMetrics],
        root_name: str = "root",
    ) -> dict[str, Any]:
        """Generate GeoJSON FeatureCollection from file metrics."""
        # Reset state
        self.grid = TileGrid()
        self.streets = []
        self.buildings = []
        self.grass = None
        self._root_name = root_name

        # Build folder tree
        tree = self._build_tree(file_metrics)

        # TODO: Implement full layout logic
        # For now, just return empty feature collection
        return self._to_geojson()

    def _build_tree(self, file_metrics: dict[str, FileMetrics]) -> dict[str, Any]:
        """Convert flat file paths into nested folder tree."""
        tree: dict[str, Any] = {}
        for path in file_metrics.keys():
            parts = PurePosixPath(path).parts
            current = tree
            for part in parts[:-1]:  # Folders only
                current = current.setdefault(part, {})
        return tree

    def _to_geojson(self) -> dict[str, Any]:
        """Convert all features to GeoJSON FeatureCollection."""
        features: list[dict[str, Any]] = []
        if self.grass:
            features.append(self.grass.to_geojson())
        features.extend(s.to_geojson() for s in self.streets)
        features.extend(b.to_geojson() for b in self.buildings)

        return {
            "type": "FeatureCollection",
            "features": features,
        }
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "tile_grid_layout_engine" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: add TileGridLayoutEngine skeleton

Basic structure with layout() method returning GeoJSON.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Main Street and Top-Level Folder Placement

**Files:**
- Modify: `src/codecity/analysis/tile_grid.py`
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the failing test**

```python
def test_tile_grid_layout_creates_main_street():
    from datetime import datetime, timezone

    from codecity.analysis.models import FileMetrics
    from codecity.analysis.tile_grid import TileGridLayoutEngine

    metrics = {
        "src/main.py": FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=datetime.now(timezone.utc),
            last_modified=datetime.now(timezone.utc),
            line_lengths=[40] * 100,
        )
    }

    engine = TileGridLayoutEngine()
    result = engine.layout(metrics, root_name="myproject")

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    main_street = next(
        (s for s in streets if s["properties"]["name"] == "myproject"), None
    )

    assert main_street is not None
    assert main_street["geometry"]["type"] == "LineString"


def test_tile_grid_layout_creates_folder_streets():
    from datetime import datetime, timezone

    from codecity.analysis.models import FileMetrics
    from codecity.analysis.tile_grid import TileGridLayoutEngine

    metrics = {
        "src/main.py": FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=datetime.now(timezone.utc),
            last_modified=datetime.now(timezone.utc),
            line_lengths=[40] * 100,
        ),
        "lib/utils.py": FileMetrics(
            path="lib/utils.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=datetime.now(timezone.utc),
            last_modified=datetime.now(timezone.utc),
            line_lengths=[35] * 50,
        ),
    }

    engine = TileGridLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]
    street_names = [s["properties"]["name"] for s in streets]

    assert "src" in street_names
    assert "lib" in street_names
```

**Step 2: Run tests to verify they fail**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "tile_grid_layout_creates" -v`
Expected: FAIL (no streets created yet)

**Step 3: Implement main street and folder placement**

This is a larger implementation. Add these methods to TileGridLayoutEngine:

```python
# Add constants at module level (after imports)
CELL_SIZE = 6  # MIN_BUILDING_WIDTH
STREET_WIDTH_CELLS = 1  # Street is 1 cell wide
BUILDING_OFFSET_CELLS = 2  # Buildings are 2 cells from street center


# Add methods to TileGridLayoutEngine class
def layout(
    self,
    file_metrics: dict[str, FileMetrics],
    root_name: str = "root",
) -> dict[str, Any]:
    """Generate GeoJSON FeatureCollection from file metrics."""
    # Reset state
    self.grid = TileGrid(cell_size=CELL_SIZE)
    self.streets = []
    self.buildings = []
    self.grass = None
    self._root_name = root_name

    # Build folder tree
    tree = self._build_tree(file_metrics)

    # Get root-level files
    root_files = [
        (path, metrics)
        for path, metrics in file_metrics.items()
        if self._parent_folder(path) == ""
    ]

    # Create main street and layout
    self._layout_main_street(tree, file_metrics, root_files)

    # Create grass area
    self._create_grass_area()

    # Normalize coordinates and return
    return self._to_geojson()

def _parent_folder(self, path: str) -> str:
    """Get parent folder path."""
    parts = PurePosixPath(path).parts
    return "/".join(parts[:-1])

def _count_descendants(
    self, folder_path: str, file_metrics: dict[str, FileMetrics]
) -> int:
    """Count all files that are descendants of this folder."""
    count = 0
    prefix = folder_path + "/" if folder_path else ""
    for path in file_metrics.keys():
        if prefix == "" or path.startswith(prefix):
            count += 1
    return count

def _layout_main_street(
    self,
    tree: dict[str, Any],
    file_metrics: dict[str, FileMetrics],
    root_files: list[tuple[str, FileMetrics]],
) -> None:
    """Create main street and place top-level folders."""
    # Calculate main street length based on content
    num_folders = len(tree)
    num_root_files = len(root_files)
    street_length_cells = max(10, num_folders * 4 + num_root_files * 2)

    # Place main street at y=0, extending in positive x
    main_street_cells: list[tuple[int, int]] = []
    for x in range(street_length_cells):
        main_street_cells.append((x, 0))

    self.grid.place_road(main_street_cells, "root", depth=0)

    # Create street feature
    start = GeoCoord(0, 0)
    end = GeoCoord(street_length_cells * CELL_SIZE, 0)

    self.streets.append(
        StreetFeature(
            path="root",
            name=self._root_name,
            depth=0,
            file_count=len(root_files),
            start=start,
            end=end,
            descendant_count=len(file_metrics),
        )
    )

    # Place root files along main street
    self._place_files_along_street(
        files=root_files,
        street_path="root",
        start_cell=(0, 0),
        direction="horizontal",
        depth=0,
    )

    # Place top-level folders
    branch_x = (len(root_files) + 1) // 2 * 2 + 2  # Start after root files
    side = 1  # Alternate north (+y) and south (-y)

    for folder_name in tree.keys():
        self._place_folder(
            tree=tree[folder_name],
            folder_path=folder_name,
            file_metrics=file_metrics,
            depth=1,
            parent_branch_cell=(branch_x, 0),
            branch_direction=side,
        )
        branch_x += 4  # Space between folder branches
        side *= -1  # Alternate sides

def _place_folder(
    self,
    tree: dict[str, Any],
    folder_path: str,
    file_metrics: dict[str, FileMetrics],
    depth: int,
    parent_branch_cell: tuple[int, int],
    branch_direction: int,
) -> None:
    """Place a folder and its contents using BFS for collision-free placement."""
    # Get files in this folder
    folder_files = [
        (path, metrics)
        for path, metrics in file_metrics.items()
        if self._parent_folder(path) == folder_path
    ]

    # Calculate space needed
    num_files = len(folder_files)
    num_subfolders = len(tree)
    width_needed = max(4, (num_files + 1) // 2 * 2, num_subfolders * 4)
    height_needed = 4  # Minimum height for a folder block

    # Find free region near parent
    search_start = (
        parent_branch_cell[0],
        parent_branch_cell[1] + branch_direction * 3,
    )
    placement = self.grid.find_free_region(
        start_pos=search_start,
        width=width_needed,
        height=height_needed,
        depth=depth,
    )

    if placement is None:
        return  # Could not place (shouldn't happen)

    px, py = placement

    # Create connector road from parent to folder
    connector_cells = self.grid.create_l_path(
        parent_branch_cell,
        (px, py),
        horizontal_first=(branch_direction == 0),
    )
    self.grid.place_road(connector_cells, f"root>{folder_path}", depth=depth)

    # Create folder street (perpendicular to parent)
    street_cells: list[tuple[int, int]] = []
    for i in range(width_needed):
        street_cells.append((px + i, py))

    self.grid.place_road(street_cells, folder_path, depth=depth)

    # Create street feature
    folder_name = PurePosixPath(folder_path).name
    start = GeoCoord(px * CELL_SIZE, py * CELL_SIZE)
    end = GeoCoord((px + width_needed) * CELL_SIZE, py * CELL_SIZE)

    self.streets.append(
        StreetFeature(
            path=folder_path,
            name=folder_name,
            depth=depth,
            file_count=len(folder_files),
            start=start,
            end=end,
            descendant_count=self._count_descendants(folder_path, file_metrics),
        )
    )

    # Place files along folder street
    self._place_files_along_street(
        files=folder_files,
        street_path=folder_path,
        start_cell=(px, py),
        direction="horizontal",
        depth=depth,
    )

    # Recursively place subfolders
    sub_branch_x = px + 2
    sub_side = 1

    for subfolder_name in tree.keys():
        subfolder_path = f"{folder_path}/{subfolder_name}"
        self._place_folder(
            tree=tree[subfolder_name],
            folder_path=subfolder_path,
            file_metrics=file_metrics,
            depth=depth + 1,
            parent_branch_cell=(sub_branch_x, py),
            branch_direction=sub_side,
        )
        sub_branch_x += 4
        sub_side *= -1

def _place_files_along_street(
    self,
    files: list[tuple[str, FileMetrics]],
    street_path: str,
    start_cell: tuple[int, int],
    direction: str,
    depth: int,
) -> None:
    """Place building features for files along a street."""
    from codecity.analysis.geojson_layout import (
        calculate_num_tiers,
        calculate_tier_widths,
        interpolate_height,
    )

    sx, sy = start_cell

    for i, (path, metrics) in enumerate(files):
        side = 1 if i % 2 == 0 else -1
        position_along = i // 2

        # Building position
        if direction == "horizontal":
            bx = sx + position_along * 2
            by = sy + side * BUILDING_OFFSET_CELLS
        else:
            bx = sx + side * BUILDING_OFFSET_CELLS
            by = sy + position_along * 2

        # Calculate building properties
        num_tiers = calculate_num_tiers(metrics.lines_of_code)
        line_lengths = getattr(metrics, "line_lengths", [])
        tier_widths = calculate_tier_widths(line_lengths, num_tiers)
        total_height = interpolate_height(metrics.lines_of_code)
        tier_height = total_height / num_tiers

        # Reserve grid cells for building
        self.grid.place_building((bx, by), path, depth, width=1, height=1)

        # Create building features for each tier
        world_x, world_y = self.grid.grid_to_world(bx, by)

        for tier_idx in range(num_tiers):
            tier_width = tier_widths[tier_idx] if tier_idx < len(tier_widths) else CELL_SIZE
            half_size = tier_width / 2
            center_x = world_x + CELL_SIZE / 2
            center_y = world_y + CELL_SIZE / 2

            corners = [
                GeoCoord(center_x - half_size, center_y - half_size),
                GeoCoord(center_x + half_size, center_y - half_size),
                GeoCoord(center_x + half_size, center_y + half_size),
                GeoCoord(center_x - half_size, center_y + half_size),
            ]

            base_height = tier_idx * tier_height
            top_height = (tier_idx + 1) * tier_height

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
                    tier=tier_idx,
                    base_height=base_height,
                    top_height=top_height,
                    tier_width=tier_width,
                )
            )

def _create_grass_area(self) -> None:
    """Create grass polygon covering the city bounds."""
    if not self.streets and not self.buildings:
        return

    min_x, min_y = float("inf"), float("inf")
    max_x, max_y = float("-inf"), float("-inf")

    for street in self.streets:
        for coord in [street.start, street.end]:
            min_x = min(min_x, coord.x)
            min_y = min(min_y, coord.y)
            max_x = max(max_x, coord.x)
            max_y = max(max_y, coord.y)

    for building in self.buildings:
        for coord in building.corners:
            min_x = min(min_x, coord.x)
            min_y = min(min_y, coord.y)
            max_x = max(max_x, coord.x)
            max_y = max(max_y, coord.y)

    margin = 10
    self.grass = GrassFeature(
        bounds=[
            GeoCoord(min_x - margin, min_y - margin),
            GeoCoord(max_x + margin, min_y - margin),
            GeoCoord(max_x + margin, max_y + margin),
            GeoCoord(min_x - margin, max_y + margin),
        ]
    )
```

**Step 4: Run tests to verify they pass**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py -k "tile_grid_layout_creates" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/tile_grid.py src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
feat: implement main street and folder placement in TileGridLayoutEngine

Uses BFS to find collision-free positions for folders and L-shaped
connectors to link them to parents.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Integration Test - No Road Intersections

**Files:**
- Test: `src/codecity/analysis/tests/test_tile_grid.py`

**Step 1: Write the integration test**

```python
def test_tile_grid_layout_no_invalid_road_crossings():
    """Roads should only cross at adjacent depths (parent-child)."""
    from datetime import datetime, timezone

    from codecity.analysis.models import FileMetrics
    from codecity.analysis.tile_grid import TileGridLayoutEngine

    # Create a structure that would cause crossings in the old algorithm
    # src/analysis/tests should NOT cross through the main src road
    metrics = {
        "src/main.py": FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=datetime.now(timezone.utc),
            last_modified=datetime.now(timezone.utc),
            line_lengths=[40] * 100,
        ),
        "src/analysis/parser.py": FileMetrics(
            path="src/analysis/parser.py",
            lines_of_code=200,
            avg_line_length=45.0,
            language="python",
            created_at=datetime.now(timezone.utc),
            last_modified=datetime.now(timezone.utc),
            line_lengths=[45] * 200,
        ),
        "src/analysis/tests/test_parser.py": FileMetrics(
            path="src/analysis/tests/test_parser.py",
            lines_of_code=150,
            avg_line_length=40.0,
            language="python",
            created_at=datetime.now(timezone.utc),
            last_modified=datetime.now(timezone.utc),
            line_lengths=[40] * 150,
        ),
    }

    engine = TileGridLayoutEngine()
    result = engine.layout(metrics)

    streets = [f for f in result["features"] if f["properties"]["layer"] == "streets"]

    # Extract street segments as sets of grid cells
    def get_street_cells(street) -> set[tuple[int, int]]:
        coords = street["geometry"]["coordinates"]
        x1, y1 = coords[0]
        x2, y2 = coords[1]
        cells = set()
        # Discretize to grid
        cell_size = 6.0
        if abs(y2 - y1) < 0.001:  # Horizontal
            for x in range(int(min(x1, x2) // cell_size), int(max(x1, x2) // cell_size) + 1):
                cells.add((x, int(y1 // cell_size)))
        else:  # Vertical
            for y in range(int(min(y1, y2) // cell_size), int(max(y1, y2) // cell_size) + 1):
                cells.add((int(x1 // cell_size), y))
        return cells

    # Check for invalid crossings
    for i, s1 in enumerate(streets):
        for s2 in streets[i + 1:]:
            depth1 = s1["properties"]["depth"]
            depth2 = s2["properties"]["depth"]

            cells1 = get_street_cells(s1)
            cells2 = get_street_cells(s2)

            intersection = cells1 & cells2
            if intersection:
                # Crossing exists - must be adjacent depths
                assert abs(depth1 - depth2) <= 1, (
                    f"Invalid crossing between {s1['properties']['path']} (depth {depth1}) "
                    f"and {s2['properties']['path']} (depth {depth2})"
                )
```

**Step 2: Run the test**

Run: `uv run pytest src/codecity/analysis/tests/test_tile_grid.py::test_tile_grid_layout_no_invalid_road_crossings -v`
Expected: PASS (if implementation is correct)

**Step 3: Commit**

```bash
git add src/codecity/analysis/tests/test_tile_grid.py
git commit -m "$(cat <<'EOF'
test: add integration test for road crossing validation

Ensures roads only cross at adjacent depths.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Feature Flag and API Integration

**Files:**
- Modify: `src/codecity/analysis/__init__.py`
- Modify: `src/codecity/api/server.py` (if exists)

**Step 1: Export TileGridLayoutEngine**

```python
# In src/codecity/analysis/__init__.py, add:
from codecity.analysis.tile_grid import TileGridLayoutEngine
```

**Step 2: Add layout engine selection (if server exists)**

Check the server code and add a parameter to select between layout engines.

**Step 3: Commit**

```bash
git add src/codecity/analysis/__init__.py
git commit -m "$(cat <<'EOF'
feat: export TileGridLayoutEngine from analysis module

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Run Full Test Suite

**Step 1: Run all tests**

Run: `uv run pytest src/codecity/analysis/tests/ -v`
Expected: All tests pass

**Step 2: Run linting and type checking**

Run: `just lint && just typecheck`
Expected: No errors

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: fix lint and type errors in tile grid implementation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | TileContent and TileGrid structures | tile_grid.py |
| 2 | Coordinate conversion | tile_grid.py |
| 3 | Building collision check | tile_grid.py |
| 4 | Road collision check with depth rules | tile_grid.py |
| 5 | Place building method | tile_grid.py |
| 6 | Place road method | tile_grid.py |
| 7 | L-shaped path generation | tile_grid.py |
| 8 | BFS region finding | tile_grid.py |
| 9 | TileGridLayoutEngine skeleton | tile_grid.py |
| 10 | Main street and folder placement | tile_grid.py |
| 11 | Integration test for crossings | test_tile_grid.py |
| 12 | API integration | __init__.py |
| 13 | Full test suite | - |
