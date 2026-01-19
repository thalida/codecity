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


def test_tile_grid_creation():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid(cell_size=6.0)
    assert grid.cell_size == 6.0
    assert grid.cells == {}


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


def test_can_place_building_empty_cell():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    assert grid.can_place_building((0, 0)) is True


def test_can_place_building_occupied_by_building():
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="building", owner_path="src/main.py", depth=1)
    assert grid.can_place_building((0, 0)) is False


def test_can_place_building_occupied_by_road():
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="src", depth=1)
    assert grid.can_place_building((0, 0)) is False


def test_can_place_road_empty_cell():
    from codecity.analysis.tile_grid import TileGrid

    grid = TileGrid()
    assert grid.can_place_road((0, 0), "src", depth=1) is True


def test_can_place_road_occupied_by_building():
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="building", owner_path="src/main.py", depth=1)
    assert grid.can_place_road((0, 0), "src", depth=1) is False


def test_can_place_road_parent_child_crossing():
    """Roads at adjacent depths can cross (parent-child relationship)."""
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    # Root road at depth 0
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="root", depth=0)
    # Child road at depth 1 can cross
    assert grid.can_place_road((0, 0), "src", depth=1) is True


def test_can_place_road_grandchild_blocked():
    """Roads at non-adjacent depths cannot cross."""
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    # Root road at depth 0
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="root", depth=0)
    # Grandchild road at depth 2 cannot cross (depth diff = 2)
    assert grid.can_place_road((0, 0), "src/analysis/tests", depth=2) is False


def test_can_place_road_same_depth_blocked():
    """Roads at the same depth cannot cross."""
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="src", depth=1)
    # Another depth-1 road cannot cross
    assert grid.can_place_road((0, 0), "lib", depth=1) is False


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
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    grid.cells[(0, 0)] = TileContent(type="road", owner_path="src", depth=1)

    result = grid.place_building((0, 0), "src/main.py", depth=1)
    assert result is False


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
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    grid.cells[(1, 0)] = TileContent(type="building", owner_path="src/main.py", depth=1)

    cells = [(0, 0), (1, 0), (2, 0)]
    result = grid.place_road(cells, "src", depth=1)

    assert result is False
    # Original cells should not be modified
    assert (0, 0) not in grid.cells
    assert (2, 0) not in grid.cells


def test_place_road_crossing_allowed():
    from codecity.analysis.tile_grid import TileContent, TileGrid

    grid = TileGrid()
    # Place parent road at depth 0
    grid.cells[(1, 0)] = TileContent(type="road", owner_path="root", depth=0)

    # Child road at depth 1 should be able to cross
    cells = [(1, -1), (1, 0), (1, 1)]
    result = grid.place_road(cells, "src", depth=1)

    assert result is True
    # The crossing cell now has the child road (overwrites)
    assert grid.cells[(1, 0)].owner_path == "src"


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
    from codecity.analysis.tile_grid import TileContent, TileGrid

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
    from codecity.analysis.tile_grid import TileContent, TileGrid

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
