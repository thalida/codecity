"""Tile-based grid for collision-free city layout.

This module implements a 2D reservation system where each cell
represents a coordinate region. Elements are placed by checking
availability first, preventing overlaps.
"""

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class TileContent:
    """Content occupying a grid cell."""

    type: Literal["road", "building", "reserved"]
    owner_path: str  # e.g., "src/analysis" - which folder/file owns this cell
    depth: int  # folder nesting level (0 = root)


@dataclass
class TileGrid:
    """2D grid for tracking occupied space."""

    cell_size: float = 6.0  # MIN_BUILDING_WIDTH
    cells: dict[tuple[int, int], TileContent] = field(default_factory=dict)

    def grid_to_world(self, grid_x: int, grid_y: int) -> tuple[float, float]:
        """Convert grid position to world coordinates."""
        return (grid_x * self.cell_size, grid_y * self.cell_size)

    def world_to_grid(self, x: float, y: float) -> tuple[int, int]:
        """Convert world coordinates to grid position."""
        return (int(x // self.cell_size), int(y // self.cell_size))

    def can_place_building(self, grid_pos: tuple[int, int]) -> bool:
        """Check if a building can be placed at this grid position.

        Buildings can only be placed in empty cells - they never overlap anything.
        """
        return grid_pos not in self.cells

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
