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
