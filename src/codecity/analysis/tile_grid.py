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
