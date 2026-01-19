"""Tile-based grid for collision-free city layout.

This module implements a 2D reservation system where each cell
represents a coordinate region. Elements are placed by checking
availability first, preventing overlaps.
"""

from collections import deque
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any, Literal

from codecity.analysis.geojson_models import (
    BuildingFeature,
    GeoCoord,
    GrassFeature,
    StreetFeature,
)
from codecity.analysis.models import FileMetrics

# Layout constants
CELL_SIZE = 6  # MIN_BUILDING_WIDTH
STREET_WIDTH_CELLS = 1
BUILDING_OFFSET_CELLS = 2


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
        num_folders = len(tree)
        num_root_files = len(root_files)
        street_length_cells = max(10, num_folders * 4 + num_root_files * 2)

        # Place main street at y=0
        main_street_cells: list[tuple[int, int]] = []
        for x in range(street_length_cells):
            main_street_cells.append((x, 0))

        self.grid.place_road(main_street_cells, "root", depth=0)

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

        # Place root files
        self._place_files_along_street(
            files=root_files,
            street_path="root",
            start_cell=(0, 0),
            direction="horizontal",
            depth=0,
        )

        # Place top-level folders
        branch_x = (len(root_files) + 1) // 2 * 2 + 2
        side = 1

        for folder_name in tree.keys():
            self._place_folder(
                tree=tree[folder_name],
                folder_path=folder_name,
                file_metrics=file_metrics,
                depth=1,
                parent_branch_cell=(branch_x, 0),
                branch_direction=side,
            )
            branch_x += 4
            side *= -1

    def _place_folder(
        self,
        tree: dict[str, Any],
        folder_path: str,
        file_metrics: dict[str, FileMetrics],
        depth: int,
        parent_branch_cell: tuple[int, int],
        branch_direction: int,
    ) -> None:
        """Place a folder using BFS for collision-free placement."""
        folder_files = [
            (path, metrics)
            for path, metrics in file_metrics.items()
            if self._parent_folder(path) == folder_path
        ]

        num_files = len(folder_files)
        num_subfolders = len(tree)
        width_needed = max(4, (num_files + 1) // 2 * 2, num_subfolders * 4)
        height_needed = 4

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
            return

        px, py = placement

        # Create connector
        connector_cells = self.grid.create_l_path(
            parent_branch_cell,
            (px, py),
            horizontal_first=(branch_direction == 0),
        )
        self.grid.place_road(connector_cells, f"root>{folder_path}", depth=depth)

        # Create folder street
        street_cells: list[tuple[int, int]] = []
        for i in range(width_needed):
            street_cells.append((px + i, py))

        self.grid.place_road(street_cells, folder_path, depth=depth)

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

            if direction == "horizontal":
                bx = sx + position_along * 2
                by = sy + side * BUILDING_OFFSET_CELLS
            else:
                bx = sx + side * BUILDING_OFFSET_CELLS
                by = sy + position_along * 2

            num_tiers = calculate_num_tiers(metrics.lines_of_code)
            line_lengths = getattr(metrics, "line_lengths", [])
            tier_widths = calculate_tier_widths(line_lengths, num_tiers)
            total_height = interpolate_height(metrics.lines_of_code)
            tier_height = total_height / num_tiers

            self.grid.place_building((bx, by), path, depth, width=1, height=1)

            world_x, world_y = self.grid.grid_to_world(bx, by)

            for tier_idx in range(num_tiers):
                tier_width = (
                    tier_widths[tier_idx] if tier_idx < len(tier_widths) else CELL_SIZE
                )
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
