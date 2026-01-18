"""Grid-based city layout with connected streets."""

from dataclasses import dataclass, field
from pathlib import PurePosixPath

from codecity.analysis.models import (
    Building,
    City,
    Direction,
    FileMetrics,
    Street,
    Tile,
    TileType,
)


@dataclass
class Folder:
    """A folder in the file tree."""

    name: str
    path: str
    files: list[FileMetrics] = field(default_factory=list)
    subfolders: list["Folder"] = field(default_factory=list)


def build_folder_tree(files: list[FileMetrics]) -> Folder:
    """Build a folder tree from a list of file metrics."""
    root = Folder(name="root", path="")

    for file_metrics in files:
        path = PurePosixPath(file_metrics.path)
        parts = path.parts

        current = root
        # Navigate/create folders for each directory in the path
        for i, part in enumerate(parts[:-1]):
            folder_path = "/".join(parts[: i + 1])
            existing = next(
                (f for f in current.subfolders if f.name == part),
                None,
            )

            if existing:
                current = existing
            else:
                new_folder = Folder(name=part, path=folder_path)
                current.subfolders.append(new_folder)
                current = new_folder

        # Add file to the final folder
        current.files.append(file_metrics)

    return root


def layout_folder(
    folder: Folder,
    start_x: int,
    start_z: int,
    parent_side: int,
    grid: dict[tuple[int, int], Tile],
    buildings: dict[str, Building],
    streets: dict[str, Street],
) -> tuple[int, int]:
    """
    Layout a folder's street with files and subfolders along the same road.
    Returns (max_z_positive, min_z_negative) bounds used by this folder.
    """
    street_length = max(len(folder.files), len(folder.subfolders), 1)
    current_x = start_x

    # Track depth used on each side
    max_z_pos = start_z
    min_z_neg = start_z

    # Place road start/intersection tile
    grid[(current_x, start_z)] = Tile(
        x=current_x,
        z=start_z,
        tile_type=TileType.ROAD_START,
        node_path=folder.path,
    )
    current_x += 1

    # Place road tiles
    for i in range(street_length):
        road_x = current_x + i
        grid[(road_x, start_z)] = Tile(
            x=road_x,
            z=start_z,
            tile_type=TileType.ROAD,
            node_path=folder.path,
        )

    # Place road end tile
    end_x = current_x + street_length
    grid[(end_x, start_z)] = Tile(
        x=end_x,
        z=start_z,
        tile_type=TileType.ROAD_END,
        node_path=folder.path,
    )

    # Place buildings - alternate sides for balance
    side_preference = -parent_side  # Start opposite to how we branched in
    for i, file_metrics in enumerate(folder.files):
        road_x = current_x + i
        if road_x < end_x:
            building = Building.from_metrics(file_metrics)
            building.grid_x = road_x
            building.grid_z = start_z
            building.road_side = side_preference
            building.road_direction = Direction.HORIZONTAL
            buildings[file_metrics.path] = building

            if side_preference > 0:
                max_z_pos = max(max_z_pos, start_z + 1)
            else:
                min_z_neg = min(min_z_neg, start_z - 1)

            side_preference *= -1  # Alternate

    # Place subfolders - they branch perpendicular from the road
    subfolder_side = -parent_side  # Start opposite to parent branch direction
    for i, subfolder in enumerate(folder.subfolders):
        road_x = current_x + i
        if road_x < end_x:
            # Create connector tile from this road to the subfolder's road
            connector_z = start_z + subfolder_side
            grid[(road_x, connector_z)] = Tile(
                x=road_x,
                z=connector_z,
                tile_type=TileType.INTERSECTION,
                node_path=subfolder.path,
                parent_path=folder.path,
            )

            # Update the road tile at this position to be an intersection
            grid[(road_x, start_z)] = Tile(
                x=road_x,
                z=start_z,
                tile_type=TileType.INTERSECTION,
                node_path=folder.path,
            )

            # Recursively layout the subfolder
            sub_max, sub_min = layout_folder(
                subfolder,
                start_x=road_x,
                start_z=connector_z,
                parent_side=subfolder_side,
                grid=grid,
                buildings=buildings,
                streets=streets,
            )
            max_z_pos = max(max_z_pos, sub_max)
            min_z_neg = min(min_z_neg, sub_min)

            subfolder_side *= -1  # Alternate sides for subfolders

    # Record street metadata
    streets[folder.path] = Street(
        path=folder.path,
        name=folder.name,
        start=(start_x, start_z),
        end=(end_x, start_z),
        direction=Direction.HORIZONTAL,
    )

    return max_z_pos, min_z_neg


def generate_grid_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Generate a city layout using grid-based connected streets.

    This is the main entry point for the new layout algorithm.
    O(n) complexity - visits each file/folder once.
    """
    # Build folder tree from files
    root = build_folder_tree(files)

    # Initialize containers
    grid: dict[tuple[int, int], Tile] = {}
    buildings: dict[str, Building] = {}
    streets: dict[str, Street] = {}

    # Layout starting from root
    layout_folder(
        root,
        start_x=0,
        start_z=0,
        parent_side=1,  # Arbitrary for root
        grid=grid,
        buildings=buildings,
        streets=streets,
    )

    # Calculate bounds
    if grid:
        all_x = [pos[0] for pos in grid.keys()]
        all_z = [pos[1] for pos in grid.keys()]
        bounds = (min(all_x), min(all_z), max(all_x), max(all_z))
    else:
        bounds = (0, 0, 0, 0)

    # Create root Street for compatibility with existing code
    root_street = streets.get("", Street(path="", name="root"))

    return City(
        root=root_street,
        repo_path=repo_path,
        grid=grid,
        buildings_dict=buildings,
        streets_dict=streets,
        bounds=bounds,
    )
