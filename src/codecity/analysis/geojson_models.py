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

    @property
    def road_class(self) -> str:
        if self.depth == 0:
            return "primary"
        elif self.depth == 1:
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
