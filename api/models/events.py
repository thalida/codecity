"""SSE event payloads for /api/manifest. Each is the `data:` body of a
named SSE event (event names: cloning/scanning/skeleton/final/error).
These models also document the stream in OpenAPI as schema components."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

from api.models.manifest import Manifest


class CloningEvent(BaseModel):
    display_root: Optional[str] = None
    stage: Optional[Literal["receiving", "resolving", "counting"]] = None
    percent: Optional[int] = None


class ScanningEvent(BaseModel):
    display_root: Optional[str] = None
    files_scanned: Optional[int] = None


class SkeletonEvent(BaseModel):
    manifest: Manifest


class FinalEvent(BaseModel):
    manifest: Manifest


class ErrorEvent(BaseModel):
    error: str
