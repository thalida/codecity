"""Wire-model validation: byte-compatible JSON + media both-or-neither rule."""

from __future__ import annotations

import unittest

from api.models.manifest import FileNode, Manifest
from pydantic import ValidationError


class ModelTests(unittest.TestCase):
    def test_file_node_media_both_or_neither_ok(self) -> None:
        FileNode(
            name="a.png",
            type="file",
            path="a.png",
            fullPath="/r/a.png",
            extension=".png",
            size=1,
            lines=0,
            binary=True,
            dirty=False,
            created="2020-01-01",
            modified="2020-01-01",
            media_width=10,
            media_height=20,
        )

    def test_file_node_media_kind_defaults_none(self) -> None:
        # Existing constructions omit mediaKind; it defaults to None.
        node = FileNode(
            name="a.ts",
            type="file",
            path="a.ts",
            fullPath="/r/a.ts",
            extension=".ts",
            size=1,
            lines=0,
            binary=False,
            dirty=False,
            created="2020-01-01",
            modified="2020-01-01",
        )
        self.assertIsNone(node.mediaKind)

    def test_file_node_media_kind_accepts_literals(self) -> None:
        for kind in ("image", "video"):
            node = FileNode(
                name="a",
                type="file",
                path="a",
                fullPath="/r/a",
                extension=".x",
                size=1,
                lines=0,
                binary=True,
                dirty=False,
                created="2020-01-01",
                modified="2020-01-01",
                mediaKind=kind,  # type: ignore[arg-type]
            )
            self.assertEqual(node.mediaKind, kind)

    def test_file_node_media_one_only_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            FileNode(
                name="a.png",
                type="file",
                path="a.png",
                fullPath="/r/a.png",
                extension=".png",
                size=1,
                lines=0,
                binary=True,
                dirty=False,
                created="2020-01-01",
                modified="2020-01-01",
                media_width=10,
            )

    def test_manifest_serializes(self) -> None:
        m = Manifest(
            root="/r",
            scanned_at="2020",
            content_signature="s",
            structure_signature="t",
            layout_signature="l",
            tree={
                "name": "r",
                "type": "directory",
                "path": "",
                "fullPath": "/r",
                "children": [],
                "children_count": 0,
                "children_file_count": 0,
                "children_dir_count": 0,
                "descendants_count": 0,
                "descendants_file_count": 0,
                "descendants_dir_count": 0,
                "descendants_size": 0,
                "descendants_created_min": None,
                "descendants_modified_max": None,
                "descendants_ext_breakdown": [],
            },
            repo={
                "branch": None,
                "remote_url": None,
                "head_sha": None,
                "head_subject": None,
                "dirty": False,
            },
            commits=[],
            busyness={"avg": 0, "busy": 0},
            dateRanges={
                "minCreated": None,
                "maxCreated": None,
                "minModified": None,
                "maxModified": None,
            },
            stats={
                "lineCountRange": {"min": 0, "max": 0},
                "byteSizeRange": {"min": 0, "max": 0},
                "oldestCreatedFile": None,
                "newestCreatedFile": None,
                "newestModifiedFile": None,
                "oldestModifiedFile": None,
                "maxLinesFile": None,
                "minLinesFile": None,
                "maxBytesFile": None,
                "minBytesFile": None,
                "maxMediaBytesFile": None,
                "minMediaBytesFile": None,
                "maxMediaPixelsFile": None,
                "minMediaPixelsFile": None,
                "maxBinaryBytesFile": None,
                "minBinaryBytesFile": None,
                "mediaCount": 0,
                "binaryCount": 0,
                "totalLines": 0,
                "dirtyFileCount": 0,
                "codeBytes": 0,
                "maxDepthDir": None,
                "maxChildrenDir": None,
                "minChildrenDir": None,
                "maxFilesPerCommit": None,
                "minFilesPerCommit": None,
                "commitDates": {"oldest": None, "newest": None},
                "maxCommitsPerDay": None,
                "maxCommitStreakDays": 0,
                "authors": [],
            },
        )
        dumped = m.model_dump(exclude_none=True)
        self.assertIn("tree", dumped)
        self.assertIn("repo", dumped)


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
        from api.models.events import ScanProgressEvent, ErrorEvent

        self.assertEqual(
            ScanProgressEvent(label="r", files_scanned=3).model_dump(exclude_none=True),
            {"label": "r", "files_scanned": 3},
        )
        self.assertEqual(ErrorEvent(error="boom").model_dump(), {"error": "boom"})
