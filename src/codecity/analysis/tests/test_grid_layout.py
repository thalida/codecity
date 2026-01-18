from datetime import datetime, timezone

from codecity.analysis.models import FileMetrics


def test_build_folder_tree_single_file() -> None:
    from codecity.analysis.grid_layout import build_folder_tree

    now = datetime.now(timezone.utc)
    files = [FileMetrics("main.py", 100, 40.0, "python", now, now)]

    root = build_folder_tree(files)

    assert root.name == "root"
    assert root.path == ""
    assert len(root.files) == 1
    assert root.files[0].path == "main.py"
    assert len(root.subfolders) == 0


def test_build_folder_tree_nested_files() -> None:
    from codecity.analysis.grid_layout import build_folder_tree

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


def test_layout_folder_creates_road_tiles() -> None:
    from codecity.analysis.grid_layout import Folder, layout_folder
    from codecity.analysis.models import Building, Street, Tile, TileType

    folder = Folder(name="src", path="src", files=[], subfolders=[])
    grid: dict[tuple[int, int], Tile] = {}
    buildings: dict[str, Building] = {}
    streets: dict[str, Street] = {}

    layout_folder(
        folder,
        start_x=0,
        start_z=0,
        parent_side=1,
        grid=grid,
        buildings=buildings,
        streets=streets,
    )

    # Should have at least road start tile
    assert (0, 0) in grid
    assert grid[(0, 0)].tile_type in (TileType.ROAD_START, TileType.INTERSECTION)


def test_layout_folder_places_buildings() -> None:
    from codecity.analysis.grid_layout import Folder, layout_folder
    from codecity.analysis.models import Building, Direction, Street, Tile

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/main.py", 100, 40.0, "python", now, now),
        FileMetrics("src/utils.py", 50, 35.0, "python", now, now),
    ]
    folder = Folder(name="src", path="src", files=files, subfolders=[])
    grid: dict[tuple[int, int], Tile] = {}
    buildings: dict[str, Building] = {}
    streets: dict[str, Street] = {}

    layout_folder(
        folder,
        start_x=0,
        start_z=0,
        parent_side=1,
        grid=grid,
        buildings=buildings,
        streets=streets,
    )

    assert "src/main.py" in buildings
    assert "src/utils.py" in buildings

    main_building = buildings["src/main.py"]
    assert main_building.grid_x >= 0
    assert main_building.road_side in (1, -1)
    assert main_building.road_direction == Direction.HORIZONTAL


def test_layout_folder_branches_subfolders() -> None:
    from codecity.analysis.grid_layout import Folder, layout_folder
    from codecity.analysis.models import Building, Street, Tile

    now = datetime.now(timezone.utc)
    child = Folder(
        name="api",
        path="src/api",
        files=[
            FileMetrics("src/api/routes.py", 50, 30.0, "python", now, now),
        ],
        subfolders=[],
    )
    parent = Folder(name="src", path="src", files=[], subfolders=[child])

    grid: dict[tuple[int, int], Tile] = {}
    buildings: dict[str, Building] = {}
    streets: dict[str, Street] = {}

    layout_folder(
        parent,
        start_x=0,
        start_z=0,
        parent_side=1,
        grid=grid,
        buildings=buildings,
        streets=streets,
    )

    # Parent street should exist
    assert "src" in streets

    # Child street should exist and branch from parent
    assert "src/api" in streets

    # Child should have buildings
    assert "src/api/routes.py" in buildings

    # There should be a connector tile from parent to child
    child_start = streets["src/api"].start
    assert child_start is not None
    # The connector should be one tile away from parent's road in z direction
    assert child_start[1] != 0  # Child not on same z as parent


def test_generate_grid_city_layout_returns_city() -> None:
    from codecity.analysis.grid_layout import generate_grid_city_layout
    from codecity.analysis.models import City

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
        assert tile.tile_type in (
            TileType.ROAD,
            TileType.INTERSECTION,
            TileType.ROAD_START,
            TileType.ROAD_END,
        ), f"Building {path} not on a road tile"
