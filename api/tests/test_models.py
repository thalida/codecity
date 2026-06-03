"""Wire-model validation: byte-compatible JSON + media both-or-neither rule."""
from __future__ import annotations

import unittest

from api.models.manifest import FileNode, Manifest
from pydantic import ValidationError


class ModelTests(unittest.TestCase):
    def test_file_node_media_both_or_neither_ok(self) -> None:
        FileNode(
            name="a.png", type="file", path="a.png", fullPath="/r/a.png",
            extension=".png", size=1, lines=0, binary=True,
            created="2020-01-01", modified="2020-01-01",
            git={"created": None, "modified": None},
            media_width=10, media_height=20,
        )

    def test_file_node_media_one_only_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            FileNode(
                name="a.png", type="file", path="a.png", fullPath="/r/a.png",
                extension=".png", size=1, lines=0, binary=True,
                created="2020-01-01", modified="2020-01-01",
                git={"created": None, "modified": None},
                media_width=10,
            )

    def test_manifest_excludes_none_optional_keys(self) -> None:
        m = Manifest(
            root="/r", scanned_at="2020", signature="s", tree_signature="t",
            tree={
                "name": "r", "type": "directory", "path": "", "fullPath": "/r",
                "children": [], "children_count": 0, "children_file_count": 0,
                "children_dir_count": 0, "descendants_count": 0,
                "descendants_file_count": 0, "descendants_dir_count": 0,
                "descendants_size": 0, "descendants_ext_breakdown": [],
            },
            repo={"branch": None, "remote_url": None, "head_sha": None,
                  "head_subject": None, "dirty": False},
            commits=[], busyness={"avg": 0, "busy": 0},
        )
        dumped = m.model_dump(exclude_none=True)
        self.assertNotIn("display_root", dumped)


class ResponseModelTests(unittest.TestCase):
    def test_error_response(self) -> None:
        from api.models.responses import ErrorResponse
        self.assertEqual(ErrorResponse(error="x").model_dump(), {"error": "x"})

    def test_health_and_config(self) -> None:
        from api.models.responses import HealthResponse, ConfigResponse
        self.assertEqual(HealthResponse(ok=True).model_dump(), {"ok": True})
        self.assertEqual(
            ConfigResponse(allowLocalRepos=False).model_dump(),
            {"allowLocalRepos": False},
        )

    def test_sse_event_serialization(self) -> None:
        from api.models.events import ScanningEvent, ErrorEvent
        self.assertEqual(
            ScanningEvent(display_root="r", files_scanned=3).model_dump(exclude_none=True),
            {"display_root": "r", "files_scanned": 3},
        )
        self.assertEqual(ErrorEvent(error="boom").model_dump(), {"error": "boom"})
