from pathlib import PurePosixPath

from codecity.analysis.models import Building, City, FileMetrics, Street


def generate_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Generate a city layout from file metrics.

    Note:
        File paths in the FileMetrics objects should use POSIX-style paths
        (forward slashes) regardless of the operating system. This ensures
        consistent path parsing across platforms.
    """
    root = Street(path="", name="root")

    for file_metrics in files:
        _add_file_to_city(root, file_metrics)

    _calculate_positions(root, 0, 0)

    return City(root=root, repo_path=repo_path)


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
