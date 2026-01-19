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
