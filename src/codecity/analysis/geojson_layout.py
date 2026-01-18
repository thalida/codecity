# src/codecity/analysis/geojson_layout.py
"""GeoJSON layout engine for MapLibre rendering."""

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from codecity.analysis.geojson_models import BuildingFeature, GeoCoord, StreetFeature
from codecity.analysis.models import FileMetrics

# Layout constants
STREET_WIDTH = 10
BUILDING_GAP = 2
BUILDING_DEPTH = 8
MIN_BUILDING_WIDTH = 4
MAX_BUILDING_WIDTH = 15


@dataclass
class GeoJSONLayoutEngine:
    """Converts file metrics into GeoJSON for MapLibre rendering."""

    streets: list[StreetFeature] = field(default_factory=list)
    buildings: list[BuildingFeature] = field(default_factory=list)
    _street_set: set[str] = field(default_factory=set)

    def layout(self, file_metrics: dict[str, FileMetrics]) -> dict[str, Any]:
        """Generate GeoJSON FeatureCollection from file metrics."""
        self.streets = []
        self.buildings = []
        self._street_set = set()

        # Build folder tree
        tree = self._build_tree(file_metrics.keys())

        # Layout starting from root (depth=-1 so first real folder gets depth=0)
        self._layout_folder(
            tree=tree,
            folder_path="",
            file_metrics=file_metrics,
            depth=-1,
            origin=GeoCoord(0, 0),
            direction="horizontal",
        )

        return self._to_geojson()

    def _build_tree(self, paths: Iterable[str]) -> dict[str, Any]:
        """Convert flat file paths into nested folder tree."""
        tree: dict = {}
        for path in paths:
            parts = PurePosixPath(path).parts
            current = tree
            for part in parts[:-1]:  # Folders only
                current = current.setdefault(part, {})
        return tree

    def _layout_folder(
        self,
        tree: dict,
        folder_path: str,
        file_metrics: dict[str, FileMetrics],
        depth: int,
        origin: GeoCoord,
        direction: str,
    ) -> float:
        """Layout a folder as a street with buildings on both sides."""
        # Get files directly in this folder
        folder_files = [
            (path, metrics)
            for path, metrics in file_metrics.items()
            if self._parent_folder(path) == folder_path
        ]

        subfolders = list(tree.keys())

        # Calculate street length
        num_buildings = len(folder_files)
        buildings_per_side = (num_buildings + 1) // 2
        min_length = max(buildings_per_side * (MAX_BUILDING_WIDTH + BUILDING_GAP), 50)

        # Street endpoints
        if direction == "horizontal":
            start = origin
            end = GeoCoord(origin.x + min_length, origin.y)
        else:
            start = origin
            end = GeoCoord(origin.x, origin.y + min_length)

        # Create street feature (skip if already exists or is root)
        street_name = PurePosixPath(folder_path).name if folder_path else "root"
        street_key = folder_path or "root"

        if street_key not in self._street_set and folder_path:
            self._street_set.add(street_key)
            self.streets.append(
                StreetFeature(
                    path=street_key,
                    name=street_name,
                    depth=depth,
                    file_count=len(folder_files),
                    start=start,
                    end=end,
                )
            )

        # Place buildings
        self._place_buildings(
            files=folder_files,
            street_path=street_key,
            street_start=start,
            direction=direction,
        )

        # Layout subfolders
        subfolder_offset = STREET_WIDTH * 2
        for i, subfolder in enumerate(subfolders):
            subfolder_path = f"{folder_path}/{subfolder}" if folder_path else subfolder
            side = 1 if i % 2 == 0 else -1
            new_direction = "vertical" if direction == "horizontal" else "horizontal"

            t = (i + 1) / (len(subfolders) + 1)
            if direction == "horizontal":
                branch_x = start.x + t * (end.x - start.x)
                branch_origin = GeoCoord(branch_x, origin.y + side * subfolder_offset)
            else:
                branch_y = start.y + t * (end.y - start.y)
                branch_origin = GeoCoord(origin.x + side * subfolder_offset, branch_y)

            self._layout_folder(
                tree=tree[subfolder],
                folder_path=subfolder_path,
                file_metrics=file_metrics,
                depth=depth + 1,
                origin=branch_origin,
                direction=new_direction,
            )

        return min_length

    def _place_buildings(
        self,
        files: list[tuple[str, FileMetrics]],
        street_path: str,
        street_start: GeoCoord,
        direction: str,
    ) -> None:
        """Place buildings along both sides of a street."""
        for i, (path, metrics) in enumerate(files):
            side = 1 if i % 2 == 0 else -1
            position_along = (i // 2) * (MAX_BUILDING_WIDTH + BUILDING_GAP)

            width = min(
                max(metrics.avg_line_length / 3, MIN_BUILDING_WIDTH),
                MAX_BUILDING_WIDTH,
            )

            if direction == "horizontal":
                x = street_start.x + position_along
                y = street_start.y + side * (STREET_WIDTH / 2 + BUILDING_DEPTH / 2)
                corners = [
                    GeoCoord(x, y - BUILDING_DEPTH / 2),
                    GeoCoord(x + width, y - BUILDING_DEPTH / 2),
                    GeoCoord(x + width, y + BUILDING_DEPTH / 2),
                    GeoCoord(x, y + BUILDING_DEPTH / 2),
                ]
            else:
                x = street_start.x + side * (STREET_WIDTH / 2 + BUILDING_DEPTH / 2)
                y = street_start.y + position_along
                corners = [
                    GeoCoord(x - BUILDING_DEPTH / 2, y),
                    GeoCoord(x + BUILDING_DEPTH / 2, y),
                    GeoCoord(x + BUILDING_DEPTH / 2, y + width),
                    GeoCoord(x - BUILDING_DEPTH / 2, y + width),
                ]

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
                )
            )

    def _parent_folder(self, path: str) -> str:
        """Get parent folder path."""
        parts = PurePosixPath(path).parts
        return "/".join(parts[:-1])

    def _to_geojson(self) -> dict[str, Any]:
        """Convert all features to GeoJSON FeatureCollection."""
        features: list[dict[str, Any]] = []
        features.extend(s.to_geojson() for s in self.streets)
        features.extend(b.to_geojson() for b in self.buildings)

        return {
            "type": "FeatureCollection",
            "features": features,
        }
