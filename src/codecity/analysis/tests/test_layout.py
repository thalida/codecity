from datetime import datetime, timezone

from codecity.analysis.layout import generate_city_layout
from codecity.analysis.models import FileMetrics


def test_tile_type_enum_exists() -> None:
    from codecity.analysis.models import TileType

    assert TileType.EMPTY.value == 0
    assert TileType.ROAD.value == 1
    assert TileType.INTERSECTION.value == 2
    assert TileType.BUILDING.value == 3
    assert TileType.ROAD_START.value == 4
    assert TileType.ROAD_END.value == 5


def test_direction_enum_exists() -> None:
    from codecity.analysis.models import Direction

    assert Direction.HORIZONTAL.value == "horizontal"
    assert Direction.VERTICAL.value == "vertical"


def test_street_model_has_grid_fields() -> None:
    from codecity.analysis.models import Direction, Street

    street = Street(
        path="src",
        name="src",
        start=(0, 0),
        end=(10, 0),
        direction=Direction.HORIZONTAL,
        depth=1,
    )
    assert street.start == (0, 0)
    assert street.end == (10, 0)
    assert street.direction == Direction.HORIZONTAL
    assert street.branch_point is None
    assert street.depth == 1


def test_tile_model_exists() -> None:
    from codecity.analysis.models import Tile, TileType

    tile = Tile(x=5, z=10, tile_type=TileType.ROAD, node_path="src")
    assert tile.x == 5
    assert tile.z == 10
    assert tile.tile_type == TileType.ROAD
    assert tile.node_path == "src"
    assert tile.parent_path is None


def test_layout_generates_city_from_metrics() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    assert city.root is not None
    assert city.repo_path == "/repo/path"


def test_layout_creates_streets_for_folders() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils/helpers.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")

    # Root should have 'src' street
    assert len(city.root.substreets) == 1
    src_street = city.root.substreets[0]
    assert src_street.name == "src"


def test_layout_places_buildings_on_streets() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    assert len(city.root.buildings) == 1
    assert city.root.buildings[0].file_path == "main.py"


def test_building_positions_are_calculated() -> None:
    """Verify that building positions are calculated (x and z are set to non-default values)."""
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    building = city.root.buildings[0]

    # Positions should be calculated (non-zero due to street margins)
    assert building.x != 0, "Building x position should be calculated"
    assert building.z != 0, "Building z position should be calculated"


def test_multiple_buildings_do_not_overlap() -> None:
    """Verify that multiple buildings don't overlap by checking positions."""
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="first.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="second.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    assert len(city.root.buildings) == 2

    first_building = city.root.buildings[0]
    second_building = city.root.buildings[1]

    # Second building should be positioned after first building's x + width
    assert second_building.x > first_building.x + first_building.width, (
        f"Buildings overlap: second.x ({second_building.x}) should be > "
        f"first.x ({first_building.x}) + first.width ({first_building.width})"
    )


def test_layout_assigns_district_colors() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/a.py", 10, 5.0, "python", now, now),
        FileMetrics("tests/b.py", 20, 6.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    # Top-level streets should have colors
    src_street = next(s for s in city.root.substreets if s.name == "src")
    tests_street = next(s for s in city.root.substreets if s.name == "tests")

    assert src_street.color is not None
    assert tests_street.color is not None
    assert src_street.color != tests_street.color  # Different colors


def test_layout_nested_streets_have_lighter_colors() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/sub/a.py", 10, 5.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    src_street = next(s for s in city.root.substreets if s.name == "src")
    sub_street = next(s for s in src_street.substreets if s.name == "sub")

    # Nested street color should be lighter (higher values)
    assert src_street.color is not None
    assert sub_street.color is not None
    assert any(sub_street.color[i] >= src_street.color[i] for i in range(3))


def test_layout_road_width_decreases_with_depth() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/sub/a.py", 10, 5.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    src_street = next(s for s in city.root.substreets if s.name == "src")
    sub_street = next(s for s in src_street.substreets if s.name == "sub")

    assert src_street.road_width > sub_street.road_width


def test_building_has_grid_fields() -> None:
    from codecity.analysis.models import Building, Direction

    now = datetime.now(timezone.utc)
    building = Building(
        file_path="src/main.py",
        height=100.0,
        width=40.0,
        depth=40.0,
        language="python",
        created_at=now,
        last_modified=now,
        grid_x=5,
        grid_z=3,
        road_side=1,
        road_direction=Direction.HORIZONTAL,
    )
    assert building.grid_x == 5
    assert building.grid_z == 3
    assert building.road_side == 1
    assert building.road_direction == Direction.HORIZONTAL


def test_city_has_grid_structure() -> None:
    from codecity.analysis.models import City, Street, Tile, TileType

    root = Street(path="", name="root")
    tile = Tile(x=0, z=0, tile_type=TileType.ROAD, node_path="")

    city = City(
        root=root,
        repo_path="/repo",
        grid={(0, 0): tile},
        buildings_dict={},
        streets_dict={"": root},
        bounds=(0, 0, 10, 10),
    )

    assert city.grid == {(0, 0): tile}
    assert city.bounds == (0, 0, 10, 10)
    assert "" in city.streets_dict


def test_generate_city_layout_uses_grid_when_flag_enabled() -> None:
    """When use_grid_layout=True, generate_city_layout uses the grid layout system."""
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path", use_grid_layout=True)

    # Grid layout should populate the grid dict with tiles
    assert city.grid is not None
    assert len(city.grid) > 0, "Grid layout should have tiles in the grid dict"
    # Should also have buildings_dict populated
    assert city.buildings_dict is not None
    assert (
        len(city.buildings_dict) > 0
    ), "Grid layout should have buildings in buildings_dict"
