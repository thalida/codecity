# src/codecity/analysis/tests/test_geojson_models.py
from codecity.analysis.geojson_models import (
    BuildingFeature,
    FootpathFeature,
    GeoCoord,
    GrassFeature,
    SidewalkFeature,
    StreetFeature,
)


def test_geocoord_to_list():
    coord = GeoCoord(x=10.5, y=20.3)
    assert coord.to_list() == [10.5, 20.3]


def test_street_feature_road_class_primary():
    """Road class is primary when descendant_count >= 50."""
    street = StreetFeature(
        path="src",
        name="src",
        depth=0,
        file_count=10,
        start=GeoCoord(0, 0),
        end=GeoCoord(100, 0),
        descendant_count=60,  # >= 50 = primary
    )
    assert street.road_class == "primary"


def test_street_feature_road_class_secondary():
    """Road class is secondary when 10 <= descendant_count < 50."""
    street = StreetFeature(
        path="src/components",
        name="components",
        depth=1,
        file_count=5,
        start=GeoCoord(0, 20),
        end=GeoCoord(50, 20),
        descendant_count=25,  # 10-49 = secondary
    )
    assert street.road_class == "secondary"


def test_street_feature_road_class_tertiary():
    """Road class is tertiary when descendant_count < 10."""
    street = StreetFeature(
        path="src/components/utils",
        name="utils",
        depth=2,
        file_count=3,
        start=GeoCoord(0, 40),
        end=GeoCoord(30, 40),
        descendant_count=5,  # < 10 = tertiary
    )
    assert street.road_class == "tertiary"


def test_street_feature_to_geojson():
    street = StreetFeature(
        path="src",
        name="src",
        depth=0,
        file_count=10,
        start=GeoCoord(0, 0),
        end=GeoCoord(100, 0),
        descendant_count=60,  # >= 50 = primary
    )
    geojson = street.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "LineString"
    assert geojson["geometry"]["coordinates"] == [[0, 0], [100, 0]]
    assert geojson["properties"]["id"] == "src"
    assert geojson["properties"]["name"] == "src"
    assert geojson["properties"]["road_class"] == "primary"
    assert geojson["properties"]["descendant_count"] == 60
    assert geojson["properties"]["layer"] == "streets"


def test_building_feature_to_geojson():
    building = BuildingFeature(
        path="src/main.py",
        name="main.py",
        street="src",
        language="python",
        lines_of_code=150,
        avg_line_length=40.5,
        created_at="2024-01-15T10:00:00Z",
        last_modified="2026-01-10T15:30:00Z",
        corners=[
            GeoCoord(10, 5),
            GeoCoord(18, 5),
            GeoCoord(18, 13),
            GeoCoord(10, 13),
        ],
    )
    geojson = building.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "Polygon"
    # Polygon coordinates should be closed (first coord repeated at end)
    coords = geojson["geometry"]["coordinates"][0]
    assert coords[0] == coords[-1]
    assert len(coords) == 5  # 4 corners + 1 closing
    assert geojson["properties"]["id"] == "src/main.py"
    assert geojson["properties"]["language"] == "python"
    assert geojson["properties"]["lines_of_code"] == 150
    assert geojson["properties"]["layer"] == "buildings"


def test_sidewalk_feature_to_geojson():
    """Sidewalk is a filled polygon, not a line."""
    sidewalk = SidewalkFeature(
        street_path="src",
        side="left",
        corners=[
            GeoCoord(0, 3),  # inner start (street edge)
            GeoCoord(100, 3),  # inner end
            GeoCoord(100, 4),  # outer end
            GeoCoord(0, 4),  # outer start
        ],
    )
    geojson = sidewalk.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "Polygon"
    coords = geojson["geometry"]["coordinates"][0]
    assert len(coords) == 5  # 4 corners + closing
    assert coords[0] == coords[-1]  # Closed polygon
    assert geojson["properties"]["layer"] == "sidewalks"
    assert geojson["properties"]["street"] == "src"
    assert geojson["properties"]["side"] == "left"


def test_footpath_feature_to_geojson():
    footpath = FootpathFeature(
        building_path="src/main.py",
        points=[
            GeoCoord(15, 9),  # building edge
            GeoCoord(14, 7),  # curve control
            GeoCoord(12, 6),  # sidewalk
        ],
    )
    geojson = footpath.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "LineString"
    assert len(geojson["geometry"]["coordinates"]) == 3
    assert geojson["properties"]["layer"] == "footpaths"
    assert geojson["properties"]["building"] == "src/main.py"


def test_grass_feature_to_geojson():
    grass = GrassFeature(
        bounds=[
            GeoCoord(-10, -10),
            GeoCoord(10, -10),
            GeoCoord(10, 10),
            GeoCoord(-10, 10),
        ]
    )
    geojson = grass.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "Polygon"
    coords = geojson["geometry"]["coordinates"][0]
    assert len(coords) == 5  # 4 corners + closing
    assert coords[0] == coords[-1]  # Closed polygon
    assert geojson["properties"]["layer"] == "grass"
