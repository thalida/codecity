# src/codecity/analysis/geojson_models.py
from dataclasses import dataclass


@dataclass
class GeoCoord:
    """Simple x/y coordinate in city space."""

    x: float
    y: float

    def to_list(self) -> list[float]:
        return [self.x, self.y]


@dataclass
class StreetFeature:
    """A folder represented as a street (LineString)."""

    path: str
    name: str
    depth: int
    file_count: int
    start: GeoCoord
    end: GeoCoord
    descendant_count: int = (
        0  # Total nested children (files + folders) for traffic-based styling
    )

    @property
    def road_class(self) -> str:
        """Determine road class based on descendant count (traffic-based hierarchy).

        More nested children = more traffic = higher road class.
        - primary: 50+ descendants (high traffic main streets)
        - secondary: 10-49 descendants (medium traffic)
        - tertiary: <10 descendants (low traffic)
        """
        if self.descendant_count >= 50:
            return "primary"
        elif self.descendant_count >= 10:
            return "secondary"
        return "tertiary"

    def to_geojson(self) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [self.start.to_list(), self.end.to_list()],
            },
            "properties": {
                "id": self.path,
                "name": self.name,
                "path": self.path,
                "depth": self.depth,
                "file_count": self.file_count,
                "descendant_count": self.descendant_count,
                "road_class": self.road_class,
                "layer": "streets",
            },
        }


@dataclass
class BuildingFeature:
    """A file represented as a building (Polygon)."""

    path: str
    name: str
    street: str
    language: str
    lines_of_code: int
    avg_line_length: float
    created_at: str
    last_modified: str
    corners: list[GeoCoord]

    def to_geojson(self) -> dict:
        # Close the polygon (first coord repeated at end)
        coords = [c.to_list() for c in self.corners]
        coords.append(coords[0])

        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "id": self.path,
                "name": self.name,
                "path": self.path,
                "street": self.street,
                "language": self.language,
                "lines_of_code": self.lines_of_code,
                "avg_line_length": self.avg_line_length,
                "created_at": self.created_at,
                "last_modified": self.last_modified,
                "layer": "buildings",
            },
        }


@dataclass
class SidewalkFeature:
    """A sidewalk running parallel to a street (LineString)."""

    street_path: str
    side: str  # "left" or "right"
    start: GeoCoord
    end: GeoCoord

    def to_geojson(self) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [self.start.to_list(), self.end.to_list()],
            },
            "properties": {
                "street": self.street_path,
                "side": self.side,
                "layer": "sidewalks",
            },
        }


@dataclass
class FootpathFeature:
    """A curved footpath connecting a building to the sidewalk (LineString)."""

    building_path: str
    points: list[GeoCoord]  # Start at building, curve to sidewalk

    def to_geojson(self) -> dict:
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [p.to_list() for p in self.points],
            },
            "properties": {
                "building": self.building_path,
                "layer": "footpaths",
            },
        }


@dataclass
class GrassFeature:
    """Grass area covering the city bounds (Polygon)."""

    bounds: list[GeoCoord]  # 4 corners

    def to_geojson(self) -> dict:
        coords = [c.to_list() for c in self.bounds]
        coords.append(coords[0])  # Close polygon
        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "layer": "grass",
            },
        }
