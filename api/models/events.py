"""SSE event payloads for /api/manifest. Each is the `data:` body of a named
SSE event. Event names describe what the event delivers (not its position in
the sequence): clone-progress / scan-progress / manifest-partial /
manifest-complete / error. These models also document the stream in OpenAPI as
schema components."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

from api.models.manifest import Manifest


class CloneProgressEvent(BaseModel):
    """`clone-progress` — git source is being cloned; carries clone progress."""

    display_root: Optional[str] = None
    stage: Optional[Literal["receiving", "resolving", "counting"]] = None
    percent: Optional[int] = None


class ScanProgressEvent(BaseModel):
    """`scan-progress` — the working tree is being walked; carries the
    heartbeat files-scanned count."""

    display_root: Optional[str] = None
    files_scanned: Optional[int] = None


class PartialManifestEvent(BaseModel):
    """`manifest-partial` — a manifest with the real tree structure but
    placeholder file metadata, sent so the UI can paint the city before
    per-file metadata is resolved."""

    manifest: Manifest


class CompleteManifestEvent(BaseModel):
    """`manifest-complete` — a manifest with real, fully-populated metadata (a
    fresh scan's final pass, or a warm cache hit)."""

    manifest: Manifest


class ErrorEvent(BaseModel):
    """`error` — a failure after the stream began; carries the message."""

    error: str
