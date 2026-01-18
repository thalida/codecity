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

    # Grid layout creates streets in streets_dict
    assert "src" in city.streets_dict
    assert "src/utils" in city.streets_dict


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
    # Grid layout stores buildings in buildings_dict
    assert "main.py" in city.buildings_dict
    assert city.buildings_dict["main.py"].file_path == "main.py"


def test_building_positions_are_calculated() -> None:
    """Verify that building grid positions are calculated."""
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
    building = city.buildings_dict["main.py"]

    # Grid positions should be set (grid_x is on road tile)
    assert building.grid_x >= 0, "Building grid_x should be set"
    assert building.road_side in (1, -1), "Building road_side should be set"


def test_multiple_buildings_do_not_overlap() -> None:
    """Verify that multiple buildings don't overlap by checking grid positions."""
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
    assert len(city.buildings_dict) == 2

    first_building = city.buildings_dict["first.py"]
    second_building = city.buildings_dict["second.py"]

    # Buildings should be on different grid positions or different road sides
    if first_building.grid_x == second_building.grid_x:
        assert (
            first_building.road_side != second_building.road_side
        ), "Buildings on same grid_x should be on different sides"
    else:
        # Different grid_x means no overlap
        pass


def test_layout_assigns_district_colors() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/a.py", 10, 5.0, "python", now, now),
        FileMetrics("tests/b.py", 20, 6.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    # Top-level streets should have colors in streets_dict
    src_street = city.streets_dict["src"]
    tests_street = city.streets_dict["tests"]

    assert src_street.color is not None
    assert tests_street.color is not None
    assert src_street.color != tests_street.color  # Different colors


def test_layout_nested_streets_have_lighter_colors() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/sub/a.py", 10, 5.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    src_street = city.streets_dict["src"]
    sub_street = city.streets_dict["src/sub"]

    # Nested street color should be lighter (higher values)
    assert src_street.color is not None
    assert sub_street.color is not None
    assert any(sub_street.color[i] >= src_street.color[i] for i in range(3))


def test_layout_depth_increases_with_nesting() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/sub/a.py", 10, 5.0, "python", now, now),
    ]
    city = generate_city_layout(files, "/repo")

    src_street = city.streets_dict["src"]
    sub_street = city.streets_dict["src/sub"]

    # Depth should increase with nesting
    assert sub_street.depth > src_street.depth


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


def test_generate_city_layout_uses_grid() -> None:
    """generate_city_layout uses the grid layout system by default."""
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

    # Grid layout should populate the grid dict with tiles
    assert city.grid is not None
    assert len(city.grid) > 0, "Grid layout should have tiles in the grid dict"
    # Should also have buildings_dict populated
    assert city.buildings_dict is not None
    assert (
        len(city.buildings_dict) > 0
    ), "Grid layout should have buildings in buildings_dict"
