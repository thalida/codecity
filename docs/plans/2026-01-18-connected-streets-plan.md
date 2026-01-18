# Connected Streets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace isolated district layout with connected street network where roads form a navigable path through the directory tree.

**Architecture:** Grid-based tile system with Strip Packing algorithm. Files and subfolders share roads, alternating sides for compactness. O(n) complexity, no collision detection needed.

**Tech Stack:** Python (Pydantic models, pytest), JavaScript (Babylon.js), FastAPI

---

## Task 1: Add TileType Enum and Tile Model

**Files:**
- Modify: [models.py](src/codecity/analysis/models.py)
- Test: [test_layout.py](src/codecity/analysis/tests/test_layout.py)

**Step 1: Write the failing test**

Add to `test_layout.py`:

```python
def test_tile_type_enum_exists() -> None:
    from codecity.analysis.models import TileType

    assert TileType.EMPTY.value == 0
    assert TileType.ROAD.value == 1
    assert TileType.INTERSECTION.value == 2
    assert TileType.BUILDING.value == 3
    assert TileType.ROAD_START.value == 4
    assert TileType.ROAD_END.value == 5


def test_tile_model_exists() -> None:
    from codecity.analysis.models import Tile, TileType

    tile = Tile(x=5, z=10, tile_type=TileType.ROAD, node_path="src")
    assert tile.x == 5
    assert tile.z == 10
    assert tile.tile_type == TileType.ROAD
    assert tile.node_path == "src"
    assert tile.parent_path is None
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_tile_type_enum_exists -v`
Expected: FAIL with "cannot import name 'TileType'"

**Step 3: Write minimal implementation**

Add to `models.py` after the imports:

```python
from enum import Enum


class TileType(Enum):
    """Type of tile in the city grid."""
    EMPTY = 0
    ROAD = 1
    INTERSECTION = 2
    BUILDING = 3
    ROAD_START = 4
    ROAD_END = 5


@dataclass
class Tile:
    """A single cell in the city grid."""
    x: int
    z: int
    tile_type: TileType
    node_path: str
    parent_path: str | None = None
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_tile_type_enum_exists src/codecity/analysis/tests/test_layout.py::test_tile_model_exists -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/models.py src/codecity/analysis/tests/test_layout.py
git commit -m "feat(models): add TileType enum and Tile dataclass for grid layout"
```

---

## Task 2: Add Direction Enum and Update Street Model

**Files:**
- Modify: [models.py](src/codecity/analysis/models.py)
- Test: [test_layout.py](src/codecity/analysis/tests/test_layout.py)

**Step 1: Write the failing test**

Add to `test_layout.py`:

```python
def test_direction_enum_exists() -> None:
    from codecity.analysis.models import Direction

    assert Direction.HORIZONTAL.value == "horizontal"
    assert Direction.VERTICAL.value == "vertical"


def test_street_model_has_grid_fields() -> None:
    from codecity.analysis.models import Direction, Street

    street = Street(
        path="src",
        name="src",
        start=(0, 0),
        end=(10, 0),
        direction=Direction.HORIZONTAL,
        depth=1,
    )
    assert street.start == (0, 0)
    assert street.end == (10, 0)
    assert street.direction == Direction.HORIZONTAL
    assert street.branch_point is None
    assert street.depth == 1
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_direction_enum_exists -v`
Expected: FAIL with "cannot import name 'Direction'"

**Step 3: Write minimal implementation**

Add to `models.py` after TileType:

```python
class Direction(Enum):
    """Direction a street runs."""
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"
```

Update the `Street` dataclass:

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
    # New grid-based fields
    start: tuple[int, int] | None = None
    end: tuple[int, int] | None = None
    direction: Direction | None = None
    branch_point: tuple[int, int] | None = None
    depth: int = 0
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_direction_enum_exists src/codecity/analysis/tests/test_layout.py::test_street_model_has_grid_fields -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/models.py src/codecity/analysis/tests/test_layout.py
git commit -m "feat(models): add Direction enum and grid fields to Street"
```

---

## Task 3: Add Grid Fields to Building Model

**Files:**
- Modify: [models.py](src/codecity/analysis/models.py)
- Test: [test_layout.py](src/codecity/analysis/tests/test_layout.py)

**Step 1: Write the failing test**

Add to `test_layout.py`:

```python
def test_building_has_grid_fields() -> None:
    from codecity.analysis.models import Building, Direction
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    building = Building(
        file_path="src/main.py",
        height=100.0,
        width=40.0,
        depth=40.0,
        language="python",
        created_at=now,
        last_modified=now,
        grid_x=5,
        grid_z=3,
        road_side=1,
        road_direction=Direction.HORIZONTAL,
    )
    assert building.grid_x == 5
    assert building.grid_z == 3
    assert building.road_side == 1
    assert building.road_direction == Direction.HORIZONTAL
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_building_has_grid_fields -v`
Expected: FAIL with "unexpected keyword argument 'grid_x'"

**Step 3: Write minimal implementation**

Update `Building` dataclass in `models.py`:

```python
@dataclass
class Building:
    file_path: str
    height: float  # lines of code
    width: float  # avg line length
    depth: float  # same as width
    language: str
    created_at: datetime
    last_modified: datetime
    x: float = 0.0
    z: float = 0.0
    # New grid-based fields
    grid_x: int = 0
    grid_z: int = 0
    road_side: int = 1  # 1 for +z side, -1 for -z side
    road_direction: Direction | None = None

    @classmethod
    def from_metrics(cls, metrics: FileMetrics) -> "Building":
        return cls(
            file_path=metrics.path,
            height=float(metrics.lines_of_code),
            width=metrics.avg_line_length,
            depth=metrics.avg_line_length,
            language=metrics.language,
            created_at=metrics.created_at,
            last_modified=metrics.last_modified,
        )
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_building_has_grid_fields -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/models.py src/codecity/analysis/tests/test_layout.py
git commit -m "feat(models): add grid position fields to Building"
```

---

## Task 4: Update City Model with Grid Structure

**Files:**
- Modify: [models.py](src/codecity/analysis/models.py)
- Test: [test_layout.py](src/codecity/analysis/tests/test_layout.py)

**Step 1: Write the failing test**

Add to `test_layout.py`:

```python
def test_city_has_grid_structure() -> None:
    from codecity.analysis.models import City, Street, Tile, TileType

    root = Street(path="", name="root")
    tile = Tile(x=0, z=0, tile_type=TileType.ROAD, node_path="")

    city = City(
        root=root,
        repo_path="/repo",
        grid={(0, 0): tile},
        buildings_dict={},
        streets_dict={"": root},
        bounds=(0, 0, 10, 10),
    )

    assert city.grid == {(0, 0): tile}
    assert city.bounds == (0, 0, 10, 10)
    assert "" in city.streets_dict
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_city_has_grid_structure -v`
Expected: FAIL with "unexpected keyword argument 'grid'"

**Step 3: Write minimal implementation**

Update `City` dataclass in `models.py`:

```python
@dataclass
class City:
    root: Street
    repo_path: str = ""
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # New grid-based fields
    grid: dict[tuple[int, int], Tile] = field(default_factory=dict)
    buildings_dict: dict[str, Building] = field(default_factory=dict)
    streets_dict: dict[str, Street] = field(default_factory=dict)
    bounds: tuple[int, int, int, int] = (0, 0, 0, 0)  # min_x, min_z, max_x, max_z
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_city_has_grid_structure -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/models.py src/codecity/analysis/tests/test_layout.py
git commit -m "feat(models): add grid, bounds, and dict fields to City"
```

---

## Task 5: Create Grid Layout Module with Folder Tree Builder

**Files:**
- Create: [grid_layout.py](src/codecity/analysis/grid_layout.py)
- Create: [test_grid_layout.py](src/codecity/analysis/tests/test_grid_layout.py)

**Step 1: Write the failing test**

Create `test_grid_layout.py`:

```python
from datetime import datetime, timezone

from codecity.analysis.models import FileMetrics


def test_build_folder_tree_single_file() -> None:
    from codecity.analysis.grid_layout import Folder, build_folder_tree

    now = datetime.now(timezone.utc)
    files = [FileMetrics("main.py", 100, 40.0, "python", now, now)]

    root = build_folder_tree(files)

    assert root.name == "root"
    assert root.path == ""
    assert len(root.files) == 1
    assert root.files[0].path == "main.py"
    assert len(root.subfolders) == 0


def test_build_folder_tree_nested_files() -> None:
    from codecity.analysis.grid_layout import Folder, build_folder_tree

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/main.py", 100, 40.0, "python", now, now),
        FileMetrics("src/utils.py", 50, 35.0, "python", now, now),
        FileMetrics("tests/test_main.py", 30, 30.0, "python", now, now),
    ]

    root = build_folder_tree(files)

    assert root.name == "root"
    assert len(root.files) == 0
    assert len(root.subfolders) == 2

    src = next(f for f in root.subfolders if f.name == "src")
    assert len(src.files) == 2

    tests = next(f for f in root.subfolders if f.name == "tests")
    assert len(tests.files) == 1
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_build_folder_tree_single_file -v`
Expected: FAIL with "No module named 'codecity.analysis.grid_layout'"

**Step 3: Write minimal implementation**

Create `grid_layout.py`:

```python
"""Grid-based city layout with connected streets."""

from dataclasses import dataclass, field
from pathlib import PurePosixPath

from codecity.analysis.models import FileMetrics


@dataclass
class Folder:
    """A folder in the file tree."""
    name: str
    path: str
    files: list[FileMetrics] = field(default_factory=list)
    subfolders: list["Folder"] = field(default_factory=list)


def build_folder_tree(files: list[FileMetrics]) -> Folder:
    """Build a folder tree from a list of file metrics."""
    root = Folder(name="root", path="")

    for file_metrics in files:
        path = PurePosixPath(file_metrics.path)
        parts = path.parts

        current = root
        # Navigate/create folders for each directory in the path
        for i, part in enumerate(parts[:-1]):
            folder_path = "/".join(parts[: i + 1])
            existing = next(
                (f for f in current.subfolders if f.name == part),
                None,
            )

            if existing:
                current = existing
            else:
                new_folder = Folder(name=part, path=folder_path)
                current.subfolders.append(new_folder)
                current = new_folder

        # Add file to the final folder
        current.files.append(file_metrics)

    return root
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/grid_layout.py src/codecity/analysis/tests/test_grid_layout.py
git commit -m "feat(layout): add Folder dataclass and build_folder_tree function"
```

---

## Task 6: Implement Basic Road Placement

**Files:**
- Modify: [grid_layout.py](src/codecity/analysis/grid_layout.py)
- Test: [test_grid_layout.py](src/codecity/analysis/tests/test_grid_layout.py)

**Step 1: Write the failing test**

Add to `test_grid_layout.py`:

```python
def test_layout_folder_creates_road_tiles() -> None:
    from codecity.analysis.grid_layout import Folder, layout_folder
    from codecity.analysis.models import TileType

    folder = Folder(name="src", path="src", files=[], subfolders=[])
    grid = {}
    buildings = {}
    streets = {}

    layout_folder(folder, start_x=0, start_z=0, parent_side=1, grid=grid, buildings=buildings, streets=streets)

    # Should have at least road start tile
    assert (0, 0) in grid
    assert grid[(0, 0)].tile_type in (TileType.ROAD_START, TileType.INTERSECTION)
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_layout_folder_creates_road_tiles -v`
Expected: FAIL with "cannot import name 'layout_folder'"

**Step 3: Write minimal implementation**

Add to `grid_layout.py`:

```python
from codecity.analysis.models import (
    Building,
    Direction,
    FileMetrics,
    Street,
    Tile,
    TileType,
)


def layout_folder(
    folder: Folder,
    start_x: int,
    start_z: int,
    parent_side: int,
    grid: dict[tuple[int, int], Tile],
    buildings: dict[str, Building],
    streets: dict[str, Street],
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

    # Place road start/intersection tile
    grid[(current_x, start_z)] = Tile(
        x=current_x,
        z=start_z,
        tile_type=TileType.ROAD_START,
        node_path=folder.path,
    )
    current_x += 1

    # Place road tiles
    for i in range(street_length):
        road_x = current_x + i
        grid[(road_x, start_z)] = Tile(
            x=road_x,
            z=start_z,
            tile_type=TileType.ROAD,
            node_path=folder.path,
        )

    # Place road end tile
    end_x = current_x + street_length
    grid[(end_x, start_z)] = Tile(
        x=end_x,
        z=start_z,
        tile_type=TileType.ROAD_END,
        node_path=folder.path,
    )

    # Record street metadata
    streets[folder.path] = Street(
        path=folder.path,
        name=folder.name,
        start=(start_x, start_z),
        end=(end_x, start_z),
        direction=Direction.HORIZONTAL,
    )

    return max_z_pos, min_z_neg
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_layout_folder_creates_road_tiles -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/grid_layout.py src/codecity/analysis/tests/test_grid_layout.py
git commit -m "feat(layout): add layout_folder function with basic road placement"
```

---

## Task 7: Add Building Placement to layout_folder

**Files:**
- Modify: [grid_layout.py](src/codecity/analysis/grid_layout.py)
- Test: [test_grid_layout.py](src/codecity/analysis/tests/test_grid_layout.py)

**Step 1: Write the failing test**

Add to `test_grid_layout.py`:

```python
def test_layout_folder_places_buildings() -> None:
    from codecity.analysis.grid_layout import Folder, layout_folder
    from codecity.analysis.models import Direction

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/main.py", 100, 40.0, "python", now, now),
        FileMetrics("src/utils.py", 50, 35.0, "python", now, now),
    ]
    folder = Folder(name="src", path="src", files=files, subfolders=[])
    grid = {}
    buildings = {}
    streets = {}

    layout_folder(folder, start_x=0, start_z=0, parent_side=1, grid=grid, buildings=buildings, streets=streets)

    assert "src/main.py" in buildings
    assert "src/utils.py" in buildings

    main_building = buildings["src/main.py"]
    assert main_building.grid_x >= 0
    assert main_building.road_side in (1, -1)
    assert main_building.road_direction == Direction.HORIZONTAL
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_layout_folder_places_buildings -v`
Expected: FAIL with assertion error (buildings dict is empty)

**Step 3: Write minimal implementation**

Update `layout_folder` in `grid_layout.py` to add building placement:

```python
def layout_folder(
    folder: Folder,
    start_x: int,
    start_z: int,
    parent_side: int,
    grid: dict[tuple[int, int], Tile],
    buildings: dict[str, Building],
    streets: dict[str, Street],
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

    # Place road start/intersection tile
    grid[(current_x, start_z)] = Tile(
        x=current_x,
        z=start_z,
        tile_type=TileType.ROAD_START,
        node_path=folder.path,
    )
    current_x += 1

    # Place road tiles
    for i in range(street_length):
        road_x = current_x + i
        grid[(road_x, start_z)] = Tile(
            x=road_x,
            z=start_z,
            tile_type=TileType.ROAD,
            node_path=folder.path,
        )

    # Place road end tile
    end_x = current_x + street_length
    grid[(end_x, start_z)] = Tile(
        x=end_x,
        z=start_z,
        tile_type=TileType.ROAD_END,
        node_path=folder.path,
    )

    # Place buildings - alternate sides for balance
    side_preference = -parent_side  # Start opposite to how we branched in
    for i, file_metrics in enumerate(folder.files):
        road_x = current_x + i
        if road_x < end_x:
            building = Building.from_metrics(file_metrics)
            building.grid_x = road_x
            building.grid_z = start_z
            building.road_side = side_preference
            building.road_direction = Direction.HORIZONTAL
            buildings[file_metrics.path] = building

            if side_preference > 0:
                max_z_pos = max(max_z_pos, start_z + 1)
            else:
                min_z_neg = min(min_z_neg, start_z - 1)

            side_preference *= -1  # Alternate

    # Record street metadata
    streets[folder.path] = Street(
        path=folder.path,
        name=folder.name,
        start=(start_x, start_z),
        end=(end_x, start_z),
        direction=Direction.HORIZONTAL,
    )

    return max_z_pos, min_z_neg
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_layout_folder_places_buildings -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/grid_layout.py src/codecity/analysis/tests/test_grid_layout.py
git commit -m "feat(layout): add building placement with alternating sides"
```

---

## Task 8: Add Subfolder Branching to layout_folder

**Files:**
- Modify: [grid_layout.py](src/codecity/analysis/grid_layout.py)
- Test: [test_grid_layout.py](src/codecity/analysis/tests/test_grid_layout.py)

**Step 1: Write the failing test**

Add to `test_grid_layout.py`:

```python
def test_layout_folder_branches_subfolders() -> None:
    from codecity.analysis.grid_layout import Folder, layout_folder
    from codecity.analysis.models import TileType

    now = datetime.now(timezone.utc)
    child = Folder(name="api", path="src/api", files=[
        FileMetrics("src/api/routes.py", 50, 30.0, "python", now, now),
    ], subfolders=[])
    parent = Folder(name="src", path="src", files=[], subfolders=[child])

    grid = {}
    buildings = {}
    streets = {}

    layout_folder(parent, start_x=0, start_z=0, parent_side=1, grid=grid, buildings=buildings, streets=streets)

    # Parent street should exist
    assert "src" in streets

    # Child street should exist and branch from parent
    assert "src/api" in streets

    # Child should have buildings
    assert "src/api/routes.py" in buildings

    # There should be a connector tile from parent to child
    child_start = streets["src/api"].start
    # The connector should be one tile away from parent's road in z direction
    assert child_start[1] != 0  # Child not on same z as parent
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_layout_folder_branches_subfolders -v`
Expected: FAIL (child street not created)

**Step 3: Write minimal implementation**

Update `layout_folder` in `grid_layout.py` to handle subfolders:

```python
def layout_folder(
    folder: Folder,
    start_x: int,
    start_z: int,
    parent_side: int,
    grid: dict[tuple[int, int], Tile],
    buildings: dict[str, Building],
    streets: dict[str, Street],
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

    # Place road start/intersection tile
    grid[(current_x, start_z)] = Tile(
        x=current_x,
        z=start_z,
        tile_type=TileType.ROAD_START,
        node_path=folder.path,
    )
    current_x += 1

    # Place road tiles
    for i in range(street_length):
        road_x = current_x + i
        grid[(road_x, start_z)] = Tile(
            x=road_x,
            z=start_z,
            tile_type=TileType.ROAD,
            node_path=folder.path,
        )

    # Place road end tile
    end_x = current_x + street_length
    grid[(end_x, start_z)] = Tile(
        x=end_x,
        z=start_z,
        tile_type=TileType.ROAD_END,
        node_path=folder.path,
    )

    # Interleave files and subfolders, place on alternating sides
    side_preference = -parent_side  # Start opposite to how we branched in

    # Place buildings
    for i, file_metrics in enumerate(folder.files):
        road_x = current_x + i
        if road_x < end_x:
            building = Building.from_metrics(file_metrics)
            building.grid_x = road_x
            building.grid_z = start_z
            building.road_side = side_preference
            building.road_direction = Direction.HORIZONTAL
            buildings[file_metrics.path] = building

            if side_preference > 0:
                max_z_pos = max(max_z_pos, start_z + 1)
            else:
                min_z_neg = min(min_z_neg, start_z - 1)

            side_preference *= -1  # Alternate

    # Place subfolders - they branch perpendicular from the road
    subfolder_side = -parent_side  # Start opposite to parent branch direction
    for i, subfolder in enumerate(folder.subfolders):
        road_x = current_x + i
        if road_x < end_x:
            # Create connector tile from this road to the subfolder's road
            connector_z = start_z + subfolder_side
            grid[(road_x, connector_z)] = Tile(
                x=road_x,
                z=connector_z,
                tile_type=TileType.INTERSECTION,
                node_path=subfolder.path,
                parent_path=folder.path,
            )

            # Update the road tile at this position to be an intersection
            grid[(road_x, start_z)] = Tile(
                x=road_x,
                z=start_z,
                tile_type=TileType.INTERSECTION,
                node_path=folder.path,
            )

            # Recursively layout the subfolder
            sub_max, sub_min = layout_folder(
                subfolder,
                start_x=road_x,
                start_z=connector_z,
                parent_side=subfolder_side,
                grid=grid,
                buildings=buildings,
                streets=streets,
            )
            max_z_pos = max(max_z_pos, sub_max)
            min_z_neg = min(min_z_neg, sub_min)

            subfolder_side *= -1  # Alternate sides for subfolders

    # Record street metadata
    streets[folder.path] = Street(
        path=folder.path,
        name=folder.name,
        start=(start_x, start_z),
        end=(end_x, start_z),
        direction=Direction.HORIZONTAL,
    )

    return max_z_pos, min_z_neg
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_layout_folder_branches_subfolders -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/grid_layout.py src/codecity/analysis/tests/test_grid_layout.py
git commit -m "feat(layout): add recursive subfolder branching with alternating sides"
```

---

## Task 9: Implement generate_grid_city_layout Entry Point

**Files:**
- Modify: [grid_layout.py](src/codecity/analysis/grid_layout.py)
- Test: [test_grid_layout.py](src/codecity/analysis/tests/test_grid_layout.py)

**Step 1: Write the failing test**

Add to `test_grid_layout.py`:

```python
def test_generate_grid_city_layout_returns_city() -> None:
    from codecity.analysis.grid_layout import generate_grid_city_layout
    from codecity.analysis.models import City, TileType

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/main.py", 100, 40.0, "python", now, now),
        FileMetrics("src/api/routes.py", 50, 30.0, "python", now, now),
        FileMetrics("tests/test_main.py", 30, 25.0, "python", now, now),
    ]

    city = generate_grid_city_layout(files, "/repo/path")

    assert isinstance(city, City)
    assert city.repo_path == "/repo/path"
    assert len(city.grid) > 0
    assert len(city.buildings_dict) == 3
    assert len(city.streets_dict) >= 3  # root, src, src/api, tests
    assert city.bounds[2] > city.bounds[0]  # max_x > min_x


def test_generate_grid_city_layout_all_buildings_reachable() -> None:
    """Every building should be adjacent to a road tile."""
    from codecity.analysis.grid_layout import generate_grid_city_layout
    from codecity.analysis.models import TileType

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("a.py", 10, 5.0, "python", now, now),
        FileMetrics("src/b.py", 20, 6.0, "python", now, now),
        FileMetrics("src/sub/c.py", 30, 7.0, "python", now, now),
    ]

    city = generate_grid_city_layout(files, "/repo")

    for path, building in city.buildings_dict.items():
        # Building should be at a grid position where there's a road tile
        road_pos = (building.grid_x, building.grid_z)
        assert road_pos in city.grid, f"Building {path} not adjacent to road"
        tile = city.grid[road_pos]
        assert tile.tile_type in (TileType.ROAD, TileType.INTERSECTION, TileType.ROAD_START, TileType.ROAD_END), \
            f"Building {path} not on a road tile"
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_generate_grid_city_layout_returns_city -v`
Expected: FAIL with "cannot import name 'generate_grid_city_layout'"

**Step 3: Write minimal implementation**

Add to `grid_layout.py`:

```python
from codecity.analysis.models import City


def generate_grid_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Generate a city layout using grid-based connected streets.

    This is the main entry point for the new layout algorithm.
    O(n) complexity - visits each file/folder once.
    """
    # Build folder tree from files
    root = build_folder_tree(files)

    # Initialize containers
    grid: dict[tuple[int, int], Tile] = {}
    buildings: dict[str, Building] = {}
    streets: dict[str, Street] = {}

    # Layout starting from root
    layout_folder(
        root,
        start_x=0,
        start_z=0,
        parent_side=1,  # Arbitrary for root
        grid=grid,
        buildings=buildings,
        streets=streets,
    )

    # Calculate bounds
    if grid:
        all_x = [pos[0] for pos in grid.keys()]
        all_z = [pos[1] for pos in grid.keys()]
        bounds = (min(all_x), min(all_z), max(all_x), max(all_z))
    else:
        bounds = (0, 0, 0, 0)

    # Create root Street for compatibility with existing code
    root_street = streets.get("", Street(path="", name="root"))

    return City(
        root=root_street,
        repo_path=repo_path,
        grid=grid,
        buildings_dict=buildings,
        streets_dict=streets,
        bounds=bounds,
    )
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_generate_grid_city_layout_returns_city src/codecity/analysis/tests/test_grid_layout.py::test_generate_grid_city_layout_all_buildings_reachable -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/grid_layout.py src/codecity/analysis/tests/test_grid_layout.py
git commit -m "feat(layout): add generate_grid_city_layout entry point"
```

---

## Task 10: Add Feature Flag for Grid Layout

**Files:**
- Modify: [defaults.py](src/codecity/config/defaults.py)
- Modify: [layout.py](src/codecity/analysis/layout.py)
- Test: [test_layout.py](src/codecity/analysis/tests/test_layout.py)

**Step 1: Write the failing test**

Add to `test_layout.py`:

```python
def test_generate_city_layout_uses_grid_when_flag_enabled() -> None:
    from codecity.analysis.layout import generate_city_layout

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/main.py", 100, 40.0, "python", now, now),
    ]

    city = generate_city_layout(files, "/repo", use_grid_layout=True)

    # Grid layout should populate the grid dict
    assert len(city.grid) > 0
    assert len(city.buildings_dict) > 0
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_generate_city_layout_uses_grid_when_flag_enabled -v`
Expected: FAIL with "unexpected keyword argument 'use_grid_layout'"

**Step 3: Write minimal implementation**

Update `generate_city_layout` in `layout.py`:

```python
from codecity.analysis.grid_layout import generate_grid_city_layout


def generate_city_layout(
    files: list[FileMetrics], repo_path: str, use_grid_layout: bool = False
) -> City:
    """Generate a city layout from file metrics.

    Args:
        files: List of file metrics to layout
        repo_path: Path to the repository
        use_grid_layout: If True, use new grid-based connected streets layout

    Note:
        File paths in the FileMetrics objects should use POSIX-style paths
        (forward slashes) regardless of the operating system. This ensures
        consistent path parsing across platforms.
    """
    if use_grid_layout:
        return generate_grid_city_layout(files, repo_path)

    # Original tree-based layout
    root = Street(path="", name="root")

    for file_metrics in files:
        _add_file_to_city(root, file_metrics)

    _assign_colors(root, 0, 0)
    _calculate_positions(root, 0, 0)

    return City(root=root, repo_path=repo_path)
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_layout.py::test_generate_city_layout_uses_grid_when_flag_enabled -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/layout.py src/codecity/analysis/tests/test_layout.py
git commit -m "feat(layout): add use_grid_layout flag for feature toggle"
```

---

## Task 11: Add Street Colors to Grid Layout

**Files:**
- Modify: [grid_layout.py](src/codecity/analysis/grid_layout.py)
- Test: [test_grid_layout.py](src/codecity/analysis/tests/test_grid_layout.py)

**Step 1: Write the failing test**

Add to `test_grid_layout.py`:

```python
def test_grid_layout_assigns_street_colors() -> None:
    from codecity.analysis.grid_layout import generate_grid_city_layout

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/main.py", 100, 40.0, "python", now, now),
        FileMetrics("tests/test_main.py", 50, 30.0, "python", now, now),
    ]

    city = generate_grid_city_layout(files, "/repo")

    src_street = city.streets_dict.get("src")
    tests_street = city.streets_dict.get("tests")

    assert src_street is not None
    assert tests_street is not None
    assert src_street.color is not None
    assert tests_street.color is not None
    assert src_street.color != tests_street.color  # Different colors
```

**Step 2: Run test to verify it fails**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_grid_layout_assigns_street_colors -v`
Expected: FAIL (color is None)

**Step 3: Write minimal implementation**

Update `layout_folder` in `grid_layout.py` to assign colors:

```python
from codecity.config.defaults import get_district_color


def layout_folder(
    folder: Folder,
    start_x: int,
    start_z: int,
    parent_side: int,
    grid: dict[tuple[int, int], Tile],
    buildings: dict[str, Building],
    streets: dict[str, Street],
    depth: int = 0,
    color_index: int = 0,
) -> tuple[int, int, int]:
    """
    Layout a folder's street with files and subfolders along the same road.
    Returns (max_z_positive, min_z_negative, next_color_index).
    """
    street_length = max(len(folder.files), len(folder.subfolders), 1)
    current_x = start_x

    # Track depth used on each side
    max_z_pos = start_z
    min_z_neg = start_z

    # Place road start/intersection tile
    grid[(current_x, start_z)] = Tile(
        x=current_x,
        z=start_z,
        tile_type=TileType.ROAD_START,
        node_path=folder.path,
    )
    current_x += 1

    # Place road tiles
    for i in range(street_length):
        road_x = current_x + i
        grid[(road_x, start_z)] = Tile(
            x=road_x,
            z=start_z,
            tile_type=TileType.ROAD,
            node_path=folder.path,
        )

    # Place road end tile
    end_x = current_x + street_length
    grid[(end_x, start_z)] = Tile(
        x=end_x,
        z=start_z,
        tile_type=TileType.ROAD_END,
        node_path=folder.path,
    )

    # Assign color based on depth
    street_color = get_district_color(color_index, depth) if depth > 0 else None
    next_color_index = color_index + 1 if depth > 0 else color_index

    # Place buildings
    side_preference = -parent_side
    for i, file_metrics in enumerate(folder.files):
        road_x = current_x + i
        if road_x < end_x:
            building = Building.from_metrics(file_metrics)
            building.grid_x = road_x
            building.grid_z = start_z
            building.road_side = side_preference
            building.road_direction = Direction.HORIZONTAL
            buildings[file_metrics.path] = building

            if side_preference > 0:
                max_z_pos = max(max_z_pos, start_z + 1)
            else:
                min_z_neg = min(min_z_neg, start_z - 1)

            side_preference *= -1

    # Place subfolders
    subfolder_side = -parent_side
    for i, subfolder in enumerate(folder.subfolders):
        road_x = current_x + i
        if road_x < end_x:
            connector_z = start_z + subfolder_side
            grid[(road_x, connector_z)] = Tile(
                x=road_x,
                z=connector_z,
                tile_type=TileType.INTERSECTION,
                node_path=subfolder.path,
                parent_path=folder.path,
            )

            grid[(road_x, start_z)] = Tile(
                x=road_x,
                z=start_z,
                tile_type=TileType.INTERSECTION,
                node_path=folder.path,
            )

            sub_max, sub_min, next_color_index = layout_folder(
                subfolder,
                start_x=road_x,
                start_z=connector_z,
                parent_side=subfolder_side,
                grid=grid,
                buildings=buildings,
                streets=streets,
                depth=depth + 1,
                color_index=next_color_index,
            )
            max_z_pos = max(max_z_pos, sub_max)
            min_z_neg = min(min_z_neg, sub_min)

            subfolder_side *= -1

    # Record street metadata with color
    streets[folder.path] = Street(
        path=folder.path,
        name=folder.name,
        start=(start_x, start_z),
        end=(end_x, start_z),
        direction=Direction.HORIZONTAL,
        color=street_color,
        depth=depth,
    )

    return max_z_pos, min_z_neg, next_color_index
```

Also update `generate_grid_city_layout` to handle the new return value:

```python
def generate_grid_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Generate a city layout using grid-based connected streets."""
    root = build_folder_tree(files)

    grid: dict[tuple[int, int], Tile] = {}
    buildings: dict[str, Building] = {}
    streets: dict[str, Street] = {}

    layout_folder(
        root,
        start_x=0,
        start_z=0,
        parent_side=1,
        grid=grid,
        buildings=buildings,
        streets=streets,
        depth=0,
        color_index=0,
    )

    if grid:
        all_x = [pos[0] for pos in grid.keys()]
        all_z = [pos[1] for pos in grid.keys()]
        bounds = (min(all_x), min(all_z), max(all_x), max(all_z))
    else:
        bounds = (0, 0, 0, 0)

    root_street = streets.get("", Street(path="", name="root"))

    return City(
        root=root_street,
        repo_path=repo_path,
        grid=grid,
        buildings_dict=buildings,
        streets_dict=streets,
        bounds=bounds,
    )
```

**Step 4: Run test to verify it passes**

Run: `uv run pytest src/codecity/analysis/tests/test_grid_layout.py::test_grid_layout_assigns_street_colors -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/analysis/grid_layout.py src/codecity/analysis/tests/test_grid_layout.py
git commit -m "feat(layout): add street color assignment to grid layout"
```

---

## Task 12: Update City JSON Serialization

**Files:**
- Check: [app.py](src/codecity/api/app.py) (or wherever City is serialized)
- Test: Test API endpoint returns grid data

**Step 1: Locate serialization code**

Run: `uv run grep -r "city.*json\|to_dict\|model_dump" src/codecity/api/`

**Step 2: Write the failing test**

This depends on finding the serialization location. If using FastAPI with Pydantic, may need to add a custom serializer for the grid dict with tuple keys.

Add test to verify grid data is included in API response:

```python
# In appropriate test file (e.g., test_api.py)
def test_api_returns_grid_layout_data():
    # Test that API endpoint includes grid, buildings_dict, streets_dict
    pass
```

**Step 3: Update serialization**

The grid dict uses tuple keys `(int, int)` which JSON doesn't support directly. Need to convert to string keys like `"0,0"`.

Create a serialization helper:

```python
def serialize_city_for_json(city: City) -> dict:
    """Convert City to JSON-serializable dict."""
    return {
        "repo_path": city.repo_path,
        "bounds": {
            "min_x": city.bounds[0],
            "min_z": city.bounds[1],
            "max_x": city.bounds[2],
            "max_z": city.bounds[3],
        },
        "grid": {
            f"{x},{z}": {
                "type": tile.tile_type.name.lower(),
                "path": tile.node_path,
                "parent": tile.parent_path,
            }
            for (x, z), tile in city.grid.items()
        },
        "buildings": {
            path: {
                "file_path": b.file_path,
                "x": b.grid_x,
                "z": b.grid_z,
                "road_side": b.road_side,
                "road_direction": b.road_direction.value if b.road_direction else None,
                "height": b.height,
                "width": b.width,
                "depth": b.depth,
                "language": b.language,
                "created_at": b.created_at.isoformat(),
                "last_modified": b.last_modified.isoformat(),
            }
            for path, b in city.buildings_dict.items()
        },
        "streets": {
            path: {
                "name": s.name,
                "start": list(s.start) if s.start else None,
                "end": list(s.end) if s.end else None,
                "direction": s.direction.value if s.direction else None,
                "color": list(s.color) if s.color else None,
                "depth": s.depth,
            }
            for path, s in city.streets_dict.items()
        },
    }
```

**Step 4: Update API endpoint**

Find and update the endpoint that returns city data to use the new serialization.

**Step 5: Commit**

```bash
git add src/codecity/api/*.py src/codecity/analysis/models.py
git commit -m "feat(api): add JSON serialization for grid-based city layout"
```

---

## Task 13: Update Frontend - Add Tile Rendering

**Files:**
- Modify: [city-renderer.js](src/codecity/app/city-renderer.js)
- Test: [test_city_renderer.js](src/codecity/app/__tests__/test_city_renderer.js)

**Step 1: Write the failing test**

Create or update frontend test file:

```javascript
// test_city_renderer.js
import { describe, it, expect, vi } from 'vitest';

describe('CityRenderer', () => {
    describe('renderTile', () => {
        it('renders road tile at correct position', () => {
            // Mock BABYLON
            const mockScene = {};
            const mockMesh = { position: { set: vi.fn() }, material: null };
            global.BABYLON = {
                MeshBuilder: {
                    CreateBox: vi.fn().mockReturnValue(mockMesh),
                },
                StandardMaterial: vi.fn().mockReturnValue({ diffuseColor: null }),
                Color3: vi.fn(),
            };

            const renderer = new CityRenderer(mockScene, {});
            renderer.renderTile(5, 3, { tile_type: 'road', path: 'src' });

            expect(BABYLON.MeshBuilder.CreateBox).toHaveBeenCalled();
        });
    });
});
```

**Step 2: Run test to verify it fails**

Run: `just test-js`
Expected: FAIL (renderTile method doesn't exist)

**Step 3: Implement tile rendering**

Add to `city-renderer.js`:

```javascript
const TILE_SIZE = 10; // Size of each grid tile in world units

// In CityRenderer class:
renderTile(x, z, tile) {
    const tileType = tile.tile_type || tile.type;

    switch (tileType) {
        case 'road':
        case 'road_start':
        case 'road_end':
            this.renderRoadTile(x, z, tile);
            break;
        case 'intersection':
            this.renderIntersectionTile(x, z, tile);
            break;
    }
}

renderRoadTile(x, z, tile) {
    const mesh = BABYLON.MeshBuilder.CreateBox(
        `road_${x}_${z}`,
        { width: TILE_SIZE, height: 0.1, depth: TILE_SIZE },
        this.scene
    );
    mesh.position.set(
        x * TILE_SIZE + TILE_SIZE / 2,
        0.05,
        z * TILE_SIZE + TILE_SIZE / 2
    );

    const material = new BABYLON.StandardMaterial(`roadMat_${x}_${z}`, this.scene);
    material.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.17);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    mesh.material = material;

    this.streets.push(mesh);
}

renderIntersectionTile(x, z, tile) {
    const mesh = BABYLON.MeshBuilder.CreateBox(
        `intersection_${x}_${z}`,
        { width: TILE_SIZE, height: 0.12, depth: TILE_SIZE },
        this.scene
    );
    mesh.position.set(
        x * TILE_SIZE + TILE_SIZE / 2,
        0.06,
        z * TILE_SIZE + TILE_SIZE / 2
    );

    const material = new BABYLON.StandardMaterial(`intersectionMat_${x}_${z}`, this.scene);
    material.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.22);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    mesh.material = material;

    this.streets.push(mesh);
}
```

**Step 4: Run test to verify it passes**

Run: `just test-js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-renderer.js src/codecity/app/__tests__/
git commit -m "feat(renderer): add tile-based road rendering"
```

---

## Task 14: Update Frontend - Grid-Based Building Placement

**Files:**
- Modify: [city-renderer.js](src/codecity/app/city-renderer.js)
- Test: [test_city_renderer.js](src/codecity/app/__tests__/test_city_renderer.js)

**Step 1: Write the failing test**

```javascript
describe('renderGridBuilding', () => {
    it('positions building offset from road based on road_side', () => {
        const mockScene = {};
        const mockMesh = {
            position: { x: 0, y: 0, z: 0 },
            metadata: null,
            actionManager: null,
        };
        // ... setup mocks

        const renderer = new CityRenderer(mockScene, {});
        const building = {
            file_path: 'src/main.py',
            x: 2,
            z: 0,
            road_side: 1,
            road_direction: 'horizontal',
            height: 100,
            width: 40,
        };

        renderer.renderGridBuilding(building);

        // Building should be offset in +z direction from road
        expect(mockMesh.position.z).toBeGreaterThan(0 * TILE_SIZE);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `just test-js`
Expected: FAIL (renderGridBuilding doesn't exist)

**Step 3: Implement grid-based building placement**

Add to `city-renderer.js`:

```javascript
renderGridBuilding(building) {
    const height = Math.max(building.height / 10, 1);
    const width = Math.max(building.width / 5, 2);
    const depth = width;

    const mesh = BABYLON.MeshBuilder.CreateBox(
        `building_${building.file_path}`,
        { width, height, depth },
        this.scene
    );

    // Calculate world position from grid position
    const worldX = building.x * TILE_SIZE + TILE_SIZE / 2;
    let worldZ = building.z * TILE_SIZE + TILE_SIZE / 2;

    // Offset from road based on which side
    const offset = building.road_side * (TILE_SIZE / 2 + depth / 2);

    if (building.road_direction === 'horizontal') {
        worldZ += offset;
    } else {
        // For vertical roads, offset in x direction
        mesh.position.x = worldX + offset;
        mesh.position.z = worldZ;
    }

    mesh.position.x = worldX;
    mesh.position.y = height / 2;
    mesh.position.z = worldZ + offset;

    // Material and handlers same as existing renderBuilding
    const material = new BABYLON.StandardMaterial(`mat_${building.file_path}`, this.scene);
    const color = this.calculateBuildingColor(building);
    material.diffuseColor = color;
    material.specularColor = new BABYLON.Color3(0, 0, 0);
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
    this.createBuildingLabel(building, mesh);
}
```

**Step 4: Run test to verify it passes**

Run: `just test-js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-renderer.js src/codecity/app/__tests__/
git commit -m "feat(renderer): add grid-based building placement with road offset"
```

---

## Task 15: Update Frontend - renderGridCity Method

**Files:**
- Modify: [city-renderer.js](src/codecity/app/city-renderer.js)

**Step 1: Write the failing test**

```javascript
describe('renderGridCity', () => {
    it('renders tiles and buildings from grid data', () => {
        const renderer = new CityRenderer(mockScene, {});
        const cityData = {
            bounds: { min_x: 0, min_z: 0, max_x: 10, max_z: 5 },
            grid: {
                '0,0': { type: 'road_start', path: '' },
                '1,0': { type: 'road', path: '' },
            },
            buildings: {
                'main.py': { file_path: 'main.py', x: 1, z: 0, road_side: 1, height: 50, width: 20 },
            },
        };

        renderer.renderGridCity(cityData);

        expect(renderer.streets.length).toBeGreaterThan(0);
        expect(renderer.buildings.size).toBe(1);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `just test-js`
Expected: FAIL (renderGridCity doesn't exist)

**Step 3: Implement renderGridCity**

Add to `city-renderer.js`:

```javascript
renderGridCity(cityData) {
    this.clear();
    this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');

    // Render ground plane based on bounds
    this.renderGroundPlane(cityData.bounds);

    // Render all tiles
    for (const [coords, tile] of Object.entries(cityData.grid)) {
        const [x, z] = coords.split(',').map(Number);
        this.renderTile(x, z, tile);
    }

    // Render all buildings
    for (const building of Object.values(cityData.buildings)) {
        this.renderGridBuilding(building);
    }

    // Render street signposts
    for (const [path, street] of Object.entries(cityData.streets)) {
        if (path && street.start) {
            this.renderGridSignpost(street);
        }
    }
}

renderGroundPlane(bounds) {
    const width = (bounds.max_x - bounds.min_x + 2) * TILE_SIZE;
    const depth = (bounds.max_z - bounds.min_z + 2) * TILE_SIZE;
    const centerX = ((bounds.min_x + bounds.max_x) / 2) * TILE_SIZE + TILE_SIZE / 2;
    const centerZ = ((bounds.min_z + bounds.max_z) / 2) * TILE_SIZE + TILE_SIZE / 2;

    const ground = BABYLON.MeshBuilder.CreateGround(
        'ground',
        { width, height: depth },
        this.scene
    );
    ground.position.x = centerX;
    ground.position.z = centerZ;

    const material = new BABYLON.StandardMaterial('groundMat', this.scene);
    material.diffuseColor = new BABYLON.Color3(0.1, 0.12, 0.1);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = material;
}

renderGridSignpost(street) {
    if (!street.name || street.name === 'root') return;

    const [startX, startZ] = street.start;
    const worldX = startX * TILE_SIZE + TILE_SIZE / 2;
    const worldZ = startZ * TILE_SIZE - TILE_SIZE / 2;

    // Create post
    const post = BABYLON.MeshBuilder.CreateCylinder(
        `signpost_post_${street.path}`,
        { height: 3, diameter: 0.2 },
        this.scene
    );
    post.position.x = worldX;
    post.position.y = 1.5;
    post.position.z = worldZ;

    const postMat = new BABYLON.StandardMaterial(`signpostMat_${street.path}`, this.scene);
    postMat.diffuseColor = new BABYLON.Color3(0.3, 0.25, 0.2);
    postMat.specularColor = new BABYLON.Color3(0, 0, 0);
    post.material = postMat;

    // Create sign (reuse existing texture logic)
    const sign = BABYLON.MeshBuilder.CreatePlane(
        `signpost_sign_${street.path}`,
        { width: Math.max(street.name.length * 0.4, 2), height: 0.8 },
        this.scene
    );
    sign.position.x = worldX + Math.max(street.name.length * 0.2, 1);
    sign.position.y = 2.8;
    sign.position.z = worldZ;
    sign.rotation.y = Math.PI / 2;

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

**Step 4: Run test to verify it passes**

Run: `just test-js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-renderer.js src/codecity/app/__tests__/
git commit -m "feat(renderer): add renderGridCity for tile-based city rendering"
```

---

## Task 16: Update render() Method to Detect Layout Type

**Files:**
- Modify: [city-renderer.js](src/codecity/app/city-renderer.js)

**Step 1: Write the failing test**

```javascript
describe('render', () => {
    it('calls renderGridCity when cityData has grid property', () => {
        const renderer = new CityRenderer(mockScene, {});
        renderer.renderGridCity = vi.fn();
        renderer.renderStreet = vi.fn();

        const gridCityData = {
            grid: { '0,0': { type: 'road' } },
            buildings: {},
            streets: {},
            bounds: { min_x: 0, min_z: 0, max_x: 1, max_z: 1 },
        };

        renderer.render(gridCityData);

        expect(renderer.renderGridCity).toHaveBeenCalledWith(gridCityData);
        expect(renderer.renderStreet).not.toHaveBeenCalled();
    });

    it('calls renderStreet when cityData has root property', () => {
        const renderer = new CityRenderer(mockScene, {});
        renderer.renderGridCity = vi.fn();
        renderer.renderStreet = vi.fn();

        const treeCityData = {
            root: { buildings: [], substreets: [] },
        };

        renderer.render(treeCityData);

        expect(renderer.renderStreet).toHaveBeenCalled();
        expect(renderer.renderGridCity).not.toHaveBeenCalled();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `just test-js`
Expected: FAIL (render doesn't detect layout type)

**Step 3: Update render method**

```javascript
render(cityData) {
    this.clear();
    this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');

    // Detect layout type and render accordingly
    if (cityData.grid && Object.keys(cityData.grid).length > 0) {
        // Grid-based connected streets layout
        this.renderGridCity(cityData);
    } else if (cityData.root) {
        // Original tree-based district layout
        this.renderStreet(cityData.root, true);
    }
}
```

**Step 4: Run test to verify it passes**

Run: `just test-js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/codecity/app/city-renderer.js src/codecity/app/__tests__/
git commit -m "feat(renderer): auto-detect layout type in render method"
```

---

## Task 17: Integration Test - End to End

**Files:**
- Test: [test_integration.py](src/codecity/analysis/tests/test_integration.py)

**Step 1: Write the integration test**

```python
"""Integration tests for the full city generation pipeline."""
from datetime import datetime, timezone
import json

from codecity.analysis.grid_layout import generate_grid_city_layout
from codecity.analysis.models import FileMetrics, TileType


def test_full_pipeline_small_repo() -> None:
    """Test full pipeline with a small repo structure."""
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("README.md", 50, 30.0, "markdown", now, now),
        FileMetrics("src/main.py", 200, 45.0, "python", now, now),
        FileMetrics("src/utils.py", 100, 40.0, "python", now, now),
        FileMetrics("src/api/routes.py", 150, 35.0, "python", now, now),
        FileMetrics("src/api/models.py", 80, 30.0, "python", now, now),
        FileMetrics("tests/test_main.py", 120, 35.0, "python", now, now),
        FileMetrics("tests/test_utils.py", 60, 30.0, "python", now, now),
    ]

    city = generate_grid_city_layout(files, "/test/repo")

    # Verify structure
    assert city.repo_path == "/test/repo"
    assert len(city.buildings_dict) == 7
    assert "src" in city.streets_dict
    assert "src/api" in city.streets_dict
    assert "tests" in city.streets_dict

    # Verify all buildings are on road tiles
    for path, building in city.buildings_dict.items():
        pos = (building.grid_x, building.grid_z)
        assert pos in city.grid, f"Building {path} not on grid"
        tile = city.grid[pos]
        assert tile.tile_type in (
            TileType.ROAD, TileType.INTERSECTION,
            TileType.ROAD_START, TileType.ROAD_END
        )

    # Verify connectivity - all streets should connect back to root
    # by following parent_path in tiles
    for street_path, street in city.streets_dict.items():
        if street_path:  # Skip root
            start = street.start
            assert start in city.grid


def test_serialization_round_trip() -> None:
    """Test that city can be serialized to JSON and back."""
    from codecity.analysis.grid_layout import generate_grid_city_layout
    # Assuming we have a serialize function

    now = datetime.now(timezone.utc)
    files = [FileMetrics("main.py", 100, 40.0, "python", now, now)]
    city = generate_grid_city_layout(files, "/repo")

    # Test that grid keys can be converted to string format for JSON
    grid_json = {
        f"{x},{z}": {
            "type": tile.tile_type.name.lower(),
            "path": tile.node_path,
        }
        for (x, z), tile in city.grid.items()
    }

    # Should be valid JSON
    json_str = json.dumps(grid_json)
    parsed = json.loads(json_str)
    assert len(parsed) == len(city.grid)
```

**Step 2: Run integration tests**

Run: `uv run pytest src/codecity/analysis/tests/test_integration.py -v`
Expected: PASS

**Step 3: Commit**

```bash
git add src/codecity/analysis/tests/test_integration.py
git commit -m "test: add integration tests for grid layout pipeline"
```

---

## Task 18: Run Full Test Suite and Fix Issues

**Step 1: Run all tests**

```bash
just test && just lint && just typecheck
```

**Step 2: Fix any failures**

Address any test failures, lint errors, or type errors discovered.

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: address test suite issues from grid layout implementation"
```

---

## Task 19: Manual Visual Testing

**Step 1: Start the dev server with grid layout**

```bash
uv run codecity serve . --use-grid-layout
```

Or modify the serve command to enable grid layout by default for testing.

**Step 2: Visual verification checklist**

- [ ] Roads render as connected dark tiles
- [ ] Intersections visible where streets connect
- [ ] Buildings positioned correctly on sides of roads
- [ ] Signposts appear at street starts
- [ ] Can "walk" from root to any building via roads
- [ ] No overlapping buildings or roads
- [ ] Camera controls work correctly

**Step 3: Document any issues found**

Create issues for visual bugs that need addressing.

---

## Summary

This implementation plan covers:

1. **Tasks 1-4**: Data model updates (TileType, Tile, Direction, Street, Building, City)
2. **Tasks 5-9**: Core layout algorithm (folder tree, road placement, building placement, subfolder branching)
3. **Tasks 10-11**: Feature flag and street colors
4. **Task 12**: API serialization
5. **Tasks 13-16**: Frontend rendering updates
6. **Tasks 17-19**: Testing and verification

Total: 19 bite-sized tasks following TDD approach with frequent commits.
