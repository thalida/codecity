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
