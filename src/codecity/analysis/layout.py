from pathlib import PurePosixPath

from codecity.analysis.grid_layout import generate_grid_city_layout
from codecity.analysis.models import Building, City, FileMetrics, Street
from codecity.config.defaults import get_district_color


def generate_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Generate a city layout from file metrics using grid-based connected streets.

    Args:
        files: List of file metrics to layout
        repo_path: Path to the repository root

    Note:
        File paths in the FileMetrics objects should use POSIX-style paths
        (forward slashes) regardless of the operating system. This ensures
        consistent path parsing across platforms.
    """
    return generate_grid_city_layout(files, repo_path)


def _add_file_to_city(root: Street, metrics: FileMetrics) -> None:
    """Add a file to the city structure, creating streets as needed."""
    path = PurePosixPath(metrics.path)
    parts = path.parts

    current_street = root

    # Navigate/create streets for each folder in the path
    for i, part in enumerate(parts[:-1]):
        street_path = "/".join(parts[: i + 1])
        existing = next(
            (s for s in current_street.substreets if s.name == part),
            None,
        )

        if existing:
            current_street = existing
        else:
            new_street = Street(path=street_path, name=part)
            current_street.substreets.append(new_street)
            current_street = new_street

    # Add the building to the final street
    building = Building.from_metrics(metrics)
    current_street.buildings.append(building)


def _assign_colors(street: Street, color_index: int, depth: int) -> int:
    """Assign colors and road widths to streets based on depth.

    Args:
        street: The street to assign colors to
        color_index: The current color index for cycling through palette
        depth: The depth in the street hierarchy (0 = root)

    Returns:
        The next color index to use
    """
    # Skip root street (depth 0), assign colors to non-root streets
    if depth > 0:
        street.color = get_district_color(color_index, depth - 1)
        street.road_width = max(2.5 - depth * 0.5, 0.5)
        color_index += 1

    # Recursively assign colors to substreets
    for substreet in street.substreets:
        color_index = _assign_colors(substreet, color_index, depth + 1)

    return color_index


def _calculate_positions(
    street: Street, start_x: float, start_z: float
) -> tuple[float, float]:
    """Calculate positions for streets and buildings. Returns (width, depth) used."""
    street.x = start_x
    street.z = start_z

    current_x = start_x + 5  # Street margin
    max_z = start_z

    # Place buildings along the street
    building_z = start_z + 5  # Offset from street
    for building in street.buildings:
        building.x = current_x
        building.z = building_z
        current_x += building.width + 3  # Building width + gap
        max_z = max(max_z, building_z + building.depth)

    # Place substreets
    substreet_x = start_x
    substreet_z = max_z + 10  # Gap after buildings

    for substreet in street.substreets:
        w, d = _calculate_positions(substreet, substreet_x, substreet_z)
        substreet_x += w + 10  # Gap between substreets

    street.width = max(current_x - start_x, substreet_x - start_x)
    street.length = max(max_z - start_z, 20)

    return street.width, street.length
