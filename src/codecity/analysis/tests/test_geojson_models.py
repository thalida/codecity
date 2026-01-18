# src/codecity/analysis/tests/test_geojson_models.py
from codecity.analysis.geojson_models import BuildingFeature, GeoCoord, StreetFeature


def test_geocoord_to_list():
    coord = GeoCoord(x=10.5, y=20.3)
    assert coord.to_list() == [10.5, 20.3]


def test_street_feature_road_class_primary():
    street = StreetFeature(
        path="src",
        name="src",
        depth=0,
        file_count=10,
        start=GeoCoord(0, 0),
        end=GeoCoord(100, 0),
    )
    assert street.road_class == "primary"


def test_street_feature_road_class_secondary():
    street = StreetFeature(
        path="src/components",
        name="components",
        depth=1,
        file_count=5,
        start=GeoCoord(0, 20),
        end=GeoCoord(50, 20),
    )
    assert street.road_class == "secondary"


def test_street_feature_road_class_tertiary():
    street = StreetFeature(
        path="src/components/utils",
        name="utils",
        depth=2,
        file_count=3,
        start=GeoCoord(0, 40),
        end=GeoCoord(30, 40),
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
    )
    geojson = street.to_geojson()

    assert geojson["type"] == "Feature"
    assert geojson["geometry"]["type"] == "LineString"
    assert geojson["geometry"]["coordinates"] == [[0, 0], [100, 0]]
    assert geojson["properties"]["id"] == "src"
    assert geojson["properties"]["name"] == "src"
    assert geojson["properties"]["road_class"] == "primary"
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
