# src/codecity/analysis/geojson_layout.py
"""GeoJSON layout engine for MapLibre rendering.

This module implements a collision-free city layout algorithm:
1. A single main street runs horizontally through the center (named after root folder)
2. Top-level folders branch off the main street alternately (north/south)
3. Subfolders branch perpendicular to their parent street
4. Buildings are placed along streets with guaranteed no overlaps
5. All coordinates are computed server-side; frontend renders as-is
"""

from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from codecity.analysis.geojson_models import (
    BuildingFeature,
    GeoCoord,
    GrassFeature,
    StreetFeature,
)
from codecity.analysis.models import FileMetrics

# Layout constants
STREET_WIDTH = 6  # Narrower streets (was 10)
BUILDING_GAP = 2  # Gap between buildings
MIN_BUILDING_WIDTH = 6  # Minimum tier size
MAX_BUILDING_WIDTH = 16  # Maximum tier size (ground floor)
SIDEWALK_WIDTH = 0  # No sidewalks - buildings directly beside streets
STREET_BUILDING_CLEARANCE = 0

# Outlier trimming percentage for line length averaging (remove top/bottom X%)
OUTLIER_TRIM_PERCENT = 0.1  # 10% trimmed from each end


def calculate_num_tiers(lines_of_code: int) -> int:
    """Calculate number of building tiers based on lines of code.

    Tier count corresponds to visual building height/stories:
    - 1-50 LOC: 1 tier
    - 51-100 LOC: 2 tiers
    - 101-200 LOC: 3 tiers
    - 201-400 LOC: 4 tiers
    - 401-700 LOC: 5 tiers
    - 701-1000 LOC: 6 tiers
    - 1001-1500 LOC: 7 tiers
    - 1501-2500 LOC: 8 tiers
    - 2501-4000 LOC: 9 tiers
    - 4001+ LOC: 10 tiers (max)
    """
    if lines_of_code <= 50:
        return 1
    elif lines_of_code <= 100:
        return 2
    elif lines_of_code <= 200:
        return 3
    elif lines_of_code <= 400:
        return 4
    elif lines_of_code <= 700:
        return 5
    elif lines_of_code <= 1000:
        return 6
    elif lines_of_code <= 1500:
        return 7
    elif lines_of_code <= 2500:
        return 8
    elif lines_of_code <= 4000:
        return 9
    else:
        return 10


def _trimmed_average(values: list[int]) -> float:
    """Calculate average with outliers trimmed (top/bottom 10%).

    This provides a more representative average by excluding extreme values
    like very long comments or very short lines.
    """
    if not values:
        return 40.0  # Default

    if len(values) <= 4:
        # Too few values to trim, use simple average
        return sum(values) / len(values)

    sorted_values = sorted(values)
    trim_count = max(1, int(len(sorted_values) * OUTLIER_TRIM_PERCENT))

    # Remove top and bottom outliers
    trimmed = sorted_values[trim_count:-trim_count] if trim_count > 0 else sorted_values

    if not trimmed:
        # Edge case: trimming removed everything
        return sum(values) / len(values)

    return sum(trimmed) / len(trimmed)


def calculate_tier_widths(line_lengths: list[int], num_tiers: int) -> list[float]:
    """Calculate width for each tier based on line lengths in that section.

    Each tier's width reflects the average line length of the code in that
    section of the file (with outliers trimmed). Sections with longer lines
    produce wider tiers. If line lengths are consistent across the file,
    tiers will be uniform (creating a pillar shape).

    Args:
        line_lengths: Length of each line in the file
        num_tiers: Number of tiers to divide the file into

    Returns:
        List of widths for each tier (bottom to top), based on section averages
    """
    if num_tiers <= 0:
        return [MIN_BUILDING_WIDTH]

    if not line_lengths:
        # No line data - return uniform default width
        default_width = (MIN_BUILDING_WIDTH + MAX_BUILDING_WIDTH) / 2
        return [default_width] * num_tiers

    # Divide lines into equal sections for each tier
    lines_per_tier = len(line_lengths) // num_tiers
    remainder = len(line_lengths) % num_tiers

    widths = []
    start_idx = 0

    for tier_idx in range(num_tiers):
        # Distribute remainder lines across first few tiers
        extra = 1 if tier_idx < remainder else 0
        end_idx = start_idx + lines_per_tier + extra

        # Get line lengths for this tier's section
        section = line_lengths[start_idx:end_idx]

        # Calculate trimmed average for this section
        avg_length = _trimmed_average(section)

        # Scale more aggressively for visibility: avg_length / 2 instead of / 4
        # This maps typical 40-80 char lines to 20-40 width (before clamping)
        tier_width = min(max(avg_length / 2, MIN_BUILDING_WIDTH), MAX_BUILDING_WIDTH)
        widths.append(tier_width)

        start_idx = end_idx

    return widths


def interpolate_height(lines_of_code: int) -> float:
    """Calculate building height from lines of code.

    Uses the same interpolation as the frontend for consistency.
    """
    if lines_of_code <= 0:
        return 3.0
    elif lines_of_code <= 50:
        return 3.0 + (lines_of_code / 50) * 7.0  # 3 to 10
    elif lines_of_code <= 100:
        return 10.0 + ((lines_of_code - 50) / 50) * 15.0  # 10 to 25
    elif lines_of_code <= 300:
        return 25.0 + ((lines_of_code - 100) / 200) * 50.0  # 25 to 75
    elif lines_of_code <= 500:
        return 75.0 + ((lines_of_code - 300) / 200) * 75.0  # 75 to 150
    elif lines_of_code <= 1000:
        return 150.0 + ((lines_of_code - 500) / 500) * 150.0  # 150 to 300
    elif lines_of_code <= 3000:
        return 300.0 + ((lines_of_code - 1000) / 2000) * 200.0  # 300 to 500
    elif lines_of_code <= 5000:
        return 500.0 + ((lines_of_code - 3000) / 2000) * 328.0  # 500 to 828
    else:
        return 828.0  # Burj Khalifa max


@dataclass
class BoundingBox:
    """Axis-aligned bounding box for collision detection."""

    min_x: float
    min_y: float
    max_x: float
    max_y: float

    def overlaps(self, other: "BoundingBox", tolerance: float = 0.0) -> bool:
        """Check if this box overlaps with another."""
        return not (
            self.max_x < other.min_x - tolerance
            or other.max_x < self.min_x - tolerance
            or self.max_y < other.min_y - tolerance
            or other.max_y < self.min_y - tolerance
        )

    def expand(self, margin: float) -> "BoundingBox":
        """Return a new box expanded by margin on all sides."""
        return BoundingBox(
            self.min_x - margin,
            self.min_y - margin,
            self.max_x + margin,
            self.max_y + margin,
        )


@dataclass
class LayoutResult:
    """Result of laying out a folder, including space consumed."""

    street_length: float
    total_width: float  # Total width including buildings on both sides


@dataclass
class GeoJSONLayoutEngine:
    """Converts file metrics into GeoJSON for MapLibre rendering.

    The layout uses a "main street" metaphor where:
    - The root directory becomes a main street running horizontally
    - Top-level folders branch off perpendicular to the main street
    - Each subfolder continues this pattern recursively
    - Collision detection ensures no overlapping elements
    - Buildings sit directly beside streets (no sidewalks)
    """

    streets: list[StreetFeature] = field(default_factory=list)
    buildings: list[BuildingFeature] = field(default_factory=list)
    grass: GrassFeature | None = field(default=None)
    _occupied_boxes: list[BoundingBox] = field(default_factory=list)
    _street_set: set[str] = field(default_factory=set)
    _root_name: str = field(default="root")

    def layout(
        self, file_metrics: dict[str, FileMetrics], root_name: str = "root"
    ) -> dict[str, Any]:
        """Generate GeoJSON FeatureCollection from file metrics."""
        self.streets = []
        self.buildings = []
        self.grass = None
        self._occupied_boxes = []
        self._street_set = set()
        self._root_name = root_name

        # Build folder tree with file counts for sizing
        tree = self._build_tree(file_metrics)

        # Calculate total layout size for the main street
        root_files = [
            (path, metrics)
            for path, metrics in file_metrics.items()
            if self._parent_folder(path) == ""
        ]

        # Create main street for the root
        self._create_main_street(tree, file_metrics, root_files)

        # Create grass area covering the city
        self._create_grass_area()

        return self._to_geojson()

    def _build_tree(self, file_metrics: dict[str, FileMetrics]) -> dict[str, Any]:
        """Convert flat file paths into nested folder tree with metadata."""
        tree: dict = {}
        for path in file_metrics.keys():
            parts = PurePosixPath(path).parts
            current = tree
            for part in parts[:-1]:  # Folders only
                current = current.setdefault(part, {})
        return tree

    def _count_descendants(
        self, folder_path: str, file_metrics: dict[str, FileMetrics]
    ) -> int:
        """Count all files that are descendants of this folder.

        This is used for traffic-based road hierarchy - folders with more
        descendants have higher traffic and should be main roads.
        """
        count = 0
        prefix = folder_path + "/" if folder_path else ""
        for path in file_metrics.keys():
            if prefix == "" or path.startswith(prefix):
                count += 1
        return count

    def _create_main_street(
        self,
        tree: dict[str, Any],
        file_metrics: dict[str, FileMetrics],
        root_files: list[tuple[str, FileMetrics]],
    ) -> None:
        """Create the main street and layout all folders branching from it."""
        # Calculate space needed for each top-level folder
        folder_spaces: list[tuple[str, float]] = []
        for folder_name in tree.keys():
            space = self._calculate_folder_space(
                tree[folder_name], folder_name, file_metrics
            )
            folder_spaces.append((folder_name, space))

        # Calculate main street length based on folder spacing
        num_folders = len(folder_spaces)
        # Minimum slot width accounts for street + buildings on both sides
        min_slot_width = self._get_perpendicular_offset() * 2
        # Add space for root files
        root_buildings_space = ((len(root_files) + 1) // 2) * (
            MAX_BUILDING_WIDTH + BUILDING_GAP
        )

        # Calculate furthest branch point
        temp_x: float = root_buildings_space + BUILDING_GAP * 2
        furthest_branch: float = 0
        for folder_name, folder_space in folder_spaces:
            branch_x = temp_x + folder_space / 2
            furthest_branch = max(furthest_branch, branch_x)
            temp_x += folder_space + BUILDING_GAP * 2

        main_street_length = max(
            furthest_branch + BUILDING_GAP * 2 + 20,
            num_folders * min_slot_width + 40,
        )

        # Create the main street (named after the root folder)
        main_start = GeoCoord(0, 0)
        main_end = GeoCoord(main_street_length, 0)

        # Count all descendants for traffic-based hierarchy
        total_descendants = len(file_metrics)

        self._street_set.add("root")
        self.streets.append(
            StreetFeature(
                path="root",
                name=self._root_name,  # Use actual folder name instead of "Main Street"
                depth=0,
                file_count=len(root_files),
                start=main_start,
                end=main_end,
                descendant_count=total_descendants,
            )
        )
        self._create_sidewalks("root", main_start, main_end, "horizontal")
        self._register_street_box(main_start, main_end, "horizontal")

        # Place root-level files along main street
        self._place_buildings_along_street(
            files=root_files,
            street_path="root",
            street_start=main_start,
            direction="horizontal",
            start_offset=0,
        )

        # Layout each top-level folder branching off the main street
        current_x: float = root_buildings_space + BUILDING_GAP * 2
        for i, (folder_name, folder_space) in enumerate(folder_spaces):
            side = 1 if i % 2 == 0 else -1  # Alternate sides

            # Branch point on main street
            branch_x = current_x + folder_space / 2

            # Get perpendicular offset
            perpendicular_offset = self._get_perpendicular_offset()

            branch_origin = GeoCoord(branch_x, side * perpendicular_offset)

            # Create connector street from main street to the branch origin
            connector_start = GeoCoord(branch_x, 0)  # Point on main street
            connector_end = branch_origin  # Where the child street begins
            self._create_connector_street(
                parent_path="root",
                child_path=folder_name,
                start=connector_start,
                end=connector_end,
                file_metrics=file_metrics,
            )

            self._layout_folder(
                tree=tree[folder_name],
                folder_path=folder_name,
                file_metrics=file_metrics,
                depth=1,
                origin=branch_origin,
                direction="vertical",
                connector_start=connector_start,
            )

            current_x += folder_space + BUILDING_GAP * 2

    def _create_connector_street(
        self,
        parent_path: str,
        child_path: str,
        start: GeoCoord,
        end: GeoCoord,
        file_metrics: dict[str, FileMetrics],
    ) -> None:
        """Create a connector street from parent road to child street origin.

        This short street segment connects the branch point on the parent
        street to where the child street begins, eliminating any visual gap.
        """
        # Connector inherits the child's descendant count for styling
        descendant_count = self._count_descendants(child_path, file_metrics)

        connector_key = f"{parent_path}>{child_path}"

        if connector_key not in self._street_set:
            self._street_set.add(connector_key)
            self.streets.append(
                StreetFeature(
                    path=connector_key,
                    name="",  # Connectors don't need labels
                    depth=1,  # Intermediate depth
                    file_count=0,
                    start=start,
                    end=end,
                    descendant_count=descendant_count,
                )
            )
            # Determine direction for collision box
            if abs(end.x - start.x) > abs(end.y - start.y):
                direction = "horizontal"
            else:
                direction = "vertical"
            self._register_street_box(start, end, direction)

    def _get_perpendicular_offset(self) -> float:
        """Calculate the perpendicular offset for child streets.

        This is the distance from parent street center to child street center.
        It must account for:
        - Half of parent street width
        - Parent street's buildings (max width since tiers are centered)
        - Gap between parent buildings and child buildings
        - Child street's buildings (max width)
        - Half of child street width
        """
        return (
            STREET_WIDTH / 2  # Half of parent street
            + MAX_BUILDING_WIDTH  # Parent street building (max tier width)
            + BUILDING_GAP  # Gap between building rows
            + STREET_BUILDING_CLEARANCE  # Optional extra clearance
            + MAX_BUILDING_WIDTH  # Child street building
            + STREET_WIDTH / 2  # Half of child street
        )

    def _calculate_folder_space(
        self,
        tree: dict[str, Any],
        folder_path: str,
        file_metrics: dict[str, FileMetrics],
    ) -> float:
        """Calculate the total space needed for a folder and its subfolders."""
        # Files directly in this folder
        folder_files = [
            path
            for path in file_metrics.keys()
            if self._parent_folder(path) == folder_path
        ]

        # Space for buildings on this street
        num_buildings = len(folder_files)
        buildings_per_side = (num_buildings + 1) // 2
        building_space = buildings_per_side * (MAX_BUILDING_WIDTH + BUILDING_GAP)

        # Space for subfolders
        subfolder_space: float = 0
        for subfolder_name, subtree in tree.items():
            subfolder_path = f"{folder_path}/{subfolder_name}"
            subfolder_space += self._calculate_folder_space(
                subtree, subfolder_path, file_metrics
            )

        # Total space is max of building space and subfolder space
        min_space = self._get_perpendicular_offset() * 2
        return max(building_space, subfolder_space, min_space, 15)  # was 50

    def _layout_folder(
        self,
        tree: dict[str, Any],
        folder_path: str,
        file_metrics: dict[str, FileMetrics],
        depth: int,
        origin: GeoCoord,
        direction: str,
        connector_start: GeoCoord | None = None,
    ) -> LayoutResult:
        """Layout a folder as a street with buildings on both sides.

        Args:
            tree: Nested folder structure
            folder_path: Path to this folder
            file_metrics: All file metrics
            depth: Nesting depth
            origin: Starting point for this street
            direction: "horizontal" or "vertical"
            connector_start: Start point of connector from parent (for sidewalk extension)
        """
        # Get files directly in this folder
        folder_files = [
            (path, metrics)
            for path, metrics in file_metrics.items()
            if self._parent_folder(path) == folder_path
        ]

        subfolders = list(tree.keys())

        # Calculate space needed for this folder's contents
        num_buildings = len(folder_files)
        buildings_per_side = (num_buildings + 1) // 2
        building_space = buildings_per_side * (MAX_BUILDING_WIDTH + BUILDING_GAP)

        # Calculate space needed for subfolders
        subfolder_spaces: list[tuple[str, float]] = []
        for subfolder_name in subfolders:
            subfolder_path = f"{folder_path}/{subfolder_name}"
            space = self._calculate_folder_space(
                tree[subfolder_name], subfolder_path, file_metrics
            )
            subfolder_spaces.append((subfolder_name, space))

        # Calculate furthest branch point position
        temp_offset: float = building_space + BUILDING_GAP
        furthest_branch: float = 0
        for subfolder_name, subfolder_space in subfolder_spaces:
            position_along = temp_offset + subfolder_space / 2
            furthest_branch = max(furthest_branch, position_along)
            temp_offset += subfolder_space + BUILDING_GAP

        # Street must extend past the furthest branch point
        min_length = max(building_space, furthest_branch + BUILDING_GAP * 2, 15)

        # Street endpoints
        if direction == "horizontal":
            start = origin
            end = GeoCoord(origin.x + min_length, origin.y)
        else:
            start = origin
            end = GeoCoord(origin.x, origin.y + min_length)

        # Create street feature
        street_name = PurePosixPath(folder_path).name
        street_key = folder_path
        descendant_count = self._count_descendants(folder_path, file_metrics)

        if street_key not in self._street_set:
            self._street_set.add(street_key)
            self.streets.append(
                StreetFeature(
                    path=street_key,
                    name=street_name,
                    depth=depth,
                    file_count=len(folder_files),
                    start=start,
                    end=end,
                    descendant_count=descendant_count,
                )
            )
            self._create_sidewalks(street_key, start, end, direction, connector_start)
            self._register_street_box(start, end, direction)

        # Place buildings
        self._place_buildings_along_street(
            files=folder_files,
            street_path=street_key,
            street_start=start,
            direction=direction,
            start_offset=0,
        )

        # Layout subfolders
        current_offset: float = building_space + BUILDING_GAP
        for i, (subfolder_name, subfolder_space) in enumerate(subfolder_spaces):
            subfolder_path = f"{folder_path}/{subfolder_name}"
            side = 1 if i % 2 == 0 else -1
            new_direction = "vertical" if direction == "horizontal" else "horizontal"

            # Calculate position along this street
            position_along = current_offset + subfolder_space / 2

            # Perpendicular offset to clear parent street AND child street buildings
            perpendicular_offset = self._get_perpendicular_offset()

            if direction == "horizontal":
                child_connector_start = GeoCoord(start.x + position_along, origin.y)
                branch_origin = GeoCoord(
                    start.x + position_along, origin.y + side * perpendicular_offset
                )
            else:
                child_connector_start = GeoCoord(origin.x, start.y + position_along)
                branch_origin = GeoCoord(
                    origin.x + side * perpendicular_offset, start.y + position_along
                )

            # Create connector street from this street to the branch origin
            self._create_connector_street(
                parent_path=folder_path,
                child_path=subfolder_path,
                start=child_connector_start,
                end=branch_origin,
                file_metrics=file_metrics,
            )

            self._layout_folder(
                tree=tree[subfolder_name],
                folder_path=subfolder_path,
                file_metrics=file_metrics,
                depth=depth + 1,
                origin=branch_origin,
                direction=new_direction,
                connector_start=child_connector_start,
            )

            current_offset += subfolder_space + BUILDING_GAP

        return LayoutResult(
            street_length=min_length,
            total_width=self._get_perpendicular_offset() * 2,
        )

    def _register_street_box(
        self, start: GeoCoord, end: GeoCoord, direction: str
    ) -> None:
        """Register a street's bounding box for collision detection."""
        half_width = STREET_WIDTH / 2
        if direction == "horizontal":
            box = BoundingBox(
                min(start.x, end.x) - BUILDING_GAP,
                min(start.y, end.y) - half_width,
                max(start.x, end.x) + BUILDING_GAP,
                max(start.y, end.y) + half_width,
            )
        else:
            box = BoundingBox(
                min(start.x, end.x) - half_width,
                min(start.y, end.y) - BUILDING_GAP,
                max(start.x, end.x) + half_width,
                max(start.y, end.y) + BUILDING_GAP,
            )
        self._occupied_boxes.append(box)

    def _place_buildings_along_street(
        self,
        files: list[tuple[str, FileMetrics]],
        street_path: str,
        street_start: GeoCoord,
        direction: str,
        start_offset: float,
    ) -> float:
        """Place buildings along both sides of a street, returning end position.

        Large files produce multiple building tiers, each with potentially
        different sizes based on the average line length of that section.
        All tiers are centered around the building center point.
        Each tier has equal width and depth (square footprint).
        """
        current_offset = start_offset

        for i, (path, metrics) in enumerate(files):
            side = 1 if i % 2 == 0 else -1
            position_along = (i // 2) * (MAX_BUILDING_WIDTH + BUILDING_GAP)

            # Calculate number of tiers based on lines of code
            num_tiers = calculate_num_tiers(metrics.lines_of_code)

            # Get line_lengths from metrics (may not exist on older data)
            line_lengths = getattr(metrics, "line_lengths", [])

            # Calculate size for each tier based on line lengths in that section
            # Each tier has equal width and depth (square footprint)
            tier_sizes = calculate_tier_widths(line_lengths, num_tiers)

            # If tier_sizes doesn't have enough entries, pad with default size
            default_size = min(
                max(metrics.avg_line_length / 3, MIN_BUILDING_WIDTH),
                MAX_BUILDING_WIDTH,
            )
            while len(tier_sizes) < num_tiers:
                tier_sizes.append(default_size)

            # Calculate total height using interpolation
            total_height = interpolate_height(metrics.lines_of_code)
            tier_height = total_height / num_tiers

            # Buildings sit directly next to the street (no sidewalk)
            # Building center offset from street center = half street + half max building
            building_center_offset = STREET_WIDTH / 2 + MAX_BUILDING_WIDTH / 2

            # Calculate building center position
            if direction == "horizontal":
                center_x = street_start.x + position_along + MAX_BUILDING_WIDTH / 2
                center_y = street_start.y + side * building_center_offset
            else:
                center_x = street_start.x + side * building_center_offset
                center_y = street_start.y + position_along + MAX_BUILDING_WIDTH / 2

            # Create a BuildingFeature for each tier (centered, square footprint)
            for tier_idx in range(num_tiers):
                tier_size = tier_sizes[tier_idx]  # Same for width and depth
                half_size = tier_size / 2
                base_height = tier_idx * tier_height
                top_height = (tier_idx + 1) * tier_height

                # All tiers centered around the building center
                corners = [
                    GeoCoord(center_x - half_size, center_y - half_size),
                    GeoCoord(center_x + half_size, center_y - half_size),
                    GeoCoord(center_x + half_size, center_y + half_size),
                    GeoCoord(center_x - half_size, center_y + half_size),
                ]

                # Only register collision box for ground tier (tier_idx == 0)
                # Use max building width for collision to prevent overlaps
                if tier_idx == 0:
                    box = BoundingBox(
                        center_x - MAX_BUILDING_WIDTH / 2,
                        center_y - MAX_BUILDING_WIDTH / 2,
                        center_x + MAX_BUILDING_WIDTH / 2,
                        center_y + MAX_BUILDING_WIDTH / 2,
                    )
                    self._occupied_boxes.append(box)

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
                        tier_width=tier_size,
                    )
                )

            current_offset = max(current_offset, position_along + MAX_BUILDING_WIDTH)

        return current_offset

    def _create_sidewalks(
        self,
        street_path: str,
        start: GeoCoord,
        end: GeoCoord,
        direction: str,
        extend_to: GeoCoord | None = None,
    ) -> None:
        """Create sidewalk polygons on both sides of the street.

        Note: Currently disabled (SIDEWALK_WIDTH = 0) - buildings sit directly
        beside streets without sidewalks.
        """
        # Sidewalks disabled - buildings directly beside streets
        pass

    def _create_grass_area(self) -> None:
        """Create grass polygon covering the city bounds with margin."""
        if not self.streets and not self.buildings:
            return

        # Find bounds
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

        # Add margin
        margin = 10
        self.grass = GrassFeature(
            bounds=[
                GeoCoord(min_x - margin, min_y - margin),
                GeoCoord(max_x + margin, min_y - margin),
                GeoCoord(max_x + margin, max_y + margin),
                GeoCoord(min_x - margin, max_y + margin),
            ]
        )

    def _parent_folder(self, path: str) -> str:
        """Get parent folder path."""
        parts = PurePosixPath(path).parts
        return "/".join(parts[:-1])

    def _to_geojson(self) -> dict[str, Any]:
        """Convert all features to GeoJSON FeatureCollection.

        Coordinates are normalized to fit within valid lat/lng bounds
        (-85 to 85 for both axes) so MapLibre can render them.
        """
        # First, find the bounding box of all coordinates
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

        # Handle empty case
        if min_x == float("inf"):
            min_x, min_y, max_x, max_y = 0, 0, 1, 1

        # Calculate scale to fit within -85 to 85 (leaving margin for MapLibre)
        target_range = 0.005  # ~500m at equator for human-scale buildings
        width = max_x - min_x or 1
        height = max_y - min_y or 1
        scale = min(target_range * 2 / width, target_range * 2 / height)

        # Center offset
        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2

        def normalize_coord(coord: GeoCoord) -> GeoCoord:
            """Scale and center coordinate to fit in valid bounds."""
            return GeoCoord(
                x=(coord.x - center_x) * scale,
                y=(coord.y - center_y) * scale,
            )

        # Normalize all coordinates
        for street in self.streets:
            street.start = normalize_coord(street.start)
            street.end = normalize_coord(street.end)

        for building in self.buildings:
            building.corners = [normalize_coord(c) for c in building.corners]

        # Normalize grass bounds
        if self.grass:
            self.grass.bounds = [normalize_coord(c) for c in self.grass.bounds]

        # Now generate the GeoJSON
        features: list[dict[str, Any]] = []
        if self.grass:
            features.append(self.grass.to_geojson())
        features.extend(s.to_geojson() for s in self.streets)
        features.extend(b.to_geojson() for b in self.buildings)

        return {
            "type": "FeatureCollection",
            "features": features,
        }
