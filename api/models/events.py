"""SSE event payloads for /api/manifest and /api/timeline. Each is the `data:`
body of a named SSE event, and each documents the stream in OpenAPI as a schema
component.

The event NAMES and error codes are not here — they are wire vocabulary the
scanner and git layers also speak, so they live in api/core/constants.py."""

from __future__ import annotations

from fastapi import HTTPException
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, WithJsonSchema

from api.core.constants import ErrorCode, TimelineStage
from api.models.manifest import Manifest, OptionalInt, OptionalStr, TimelineBundle

# 'updating' is git's checkout phase ("Updating files: N%"). A heartbeat during
# the silent promisor fetch carries mb_on_disk instead of a percent.
_CLONE_STAGES = ["receiving", "resolving", "counting", "updating"]
_OptionalStage = Annotated[
    Optional[Literal["receiving", "resolving", "counting", "updating"]],
    WithJsonSchema({"enum": _CLONE_STAGES, "type": "string"}),
]


class CloneProgressEvent(BaseModel):
    """`clone-progress` — git source is being cloned; carries clone progress.

    A normal progress tick has `stage` + `percent`, plus git's own
    `objects`/`objects_total`/`mib` where the line carries them. A heartbeat
    during the silent promisor blob fetch instead carries `mb_on_disk` (and no
    percent), so the UI shows the working tree materializing, not a freeze."""

    # Server-computed display label (owner/repo or basename) so the UI shows a
    # friendly pending title without re-deriving it client-side.
    label: OptionalStr = None
    stage: _OptionalStage = None
    percent: OptionalInt = None
    mb_on_disk: OptionalInt = None
    # Git holds a percent for minutes on a big fetch while these climb.
    objects: OptionalInt = None
    objects_total: OptionalInt = None
    mib: OptionalInt = None


class ScanProgressEvent(BaseModel):
    """`scan-progress` — the working tree is being walked; carries the
    heartbeat files-scanned count."""

    # Server-computed display label — see CloneProgressEvent.label.
    label: OptionalStr = None
    files_scanned: OptionalInt = None


class PartialManifestEvent(BaseModel):
    """`manifest-partial` — a manifest with the real tree structure but
    placeholder file metadata, sent so the UI can paint the city before
    per-file metadata is resolved."""

    manifest: Manifest


class CompleteManifestEvent(BaseModel):
    """`manifest-complete` — a manifest with real, fully-populated metadata (a
    fresh scan's final pass, or a warm cache hit)."""

    manifest: Manifest


_ERROR_CODES = [c.value for c in ErrorCode]
_OptionalErrorCode = Annotated[
    Optional[ErrorCode],
    WithJsonSchema({"enum": _ERROR_CODES, "type": "string"}),
]


class ErrorEvent(BaseModel):
    """`error` — a failure after the stream began; carries the message and,
    where the UI can act on the reason, a code."""

    error: str
    code: _OptionalErrorCode = None


# Inline in the schema rather than a $ref'd component, matching _CLONE_STAGES:
# the generated TS then reads as a plain union of the wire strings.
_TimelineStage = Annotated[
    TimelineStage,
    WithJsonSchema({"enum": [s.value for s in TimelineStage], "type": "string"}),
]


class TimelineProgressEvent(BaseModel):
    """`timeline-progress` — the history walk, blob-table resolution, union
    assembly, or (for a blobless remote clone) the up-front blob backfill is in
    progress. The `fetch` stage carries `percent`; `history` carries `commits`;
    `blobs` carries `blobsDone`/`blobsTotal` (the total is known up front from
    the batch blob lookup, so that stage reports two ticks, not a live stream);
    `assemble` carries `percent` over its own steps and runs until the bundle
    lands."""

    stage: _TimelineStage
    percent: OptionalInt = None
    # `fetch` carries git's own counts beside its percent, for the same reason.
    objects: OptionalInt = None
    objectsTotal: OptionalInt = None
    mib: OptionalInt = None
    commits: OptionalInt = None
    blobsDone: OptionalInt = None
    blobsTotal: OptionalInt = None
    # Server-computed display label — see CloneProgressEvent.label.
    label: OptionalStr = None


class TimelineCompleteEvent(BaseModel):
    """`timeline-complete` — the full replay bundle (fresh build or warm
    cache hit)."""

    bundle: TimelineBundle


class CodedHTTPException(HTTPException):
    """An HTTPException that carries an ErrorCode. The app's error handler puts
    it in the response envelope, so a JSON route can say WHY in the same
    vocabulary the SSE stream uses."""

    def __init__(self, status_code: int, detail: str, code: ErrorCode) -> None:
        super().__init__(status_code, detail)
        self.code = code
