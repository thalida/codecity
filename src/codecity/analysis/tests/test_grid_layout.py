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
