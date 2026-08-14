"""SSE event payloads for /api/manifest. Each is the `data:` body of a named
SSE event. Event names describe what the event delivers (not its position in
the sequence): clone-progress / scan-progress / manifest-partial /
manifest-complete / error. These models also document the stream in OpenAPI as
schema components."""

from __future__ import annotations

from enum import StrEnum

from fastapi import HTTPException
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, WithJsonSchema

from api.models.manifest import Manifest, OptionalInt, OptionalStr, TimelineBundle


class ScanEvent(StrEnum):
    """SSE event names for the /api/manifest stream — the wire contract the
    frontend matches verbatim. Values are the exact event strings; members are
    used everywhere instead of literals. The two MANIFEST_* members double as
    scan_tree's emission `phase` (the router forwards the phase as the event
    name)."""

    CLONE_PROGRESS = "clone-progress"
    SCAN_PROGRESS = "scan-progress"
    MANIFEST_PARTIAL = "manifest-partial"
    MANIFEST_COMPLETE = "manifest-complete"
    ERROR = "error"


# These progress fields are absent-or-value, never null on the wire — same
# optional-but-non-nullable treatment as the manifest's optional fields.
# 'updating' is git's checkout phase ("Updating files: N%"); a heartbeat
# (no percent) instead carries mb_on_disk during the otherwise-silent
# promisor blob fetch of a --filter=blob:none clone.
_CLONE_STAGES = ["receiving", "resolving", "counting", "updating"]
_OptionalStage = Annotated[
    Optional[Literal["receiving", "resolving", "counting", "updating"]],
    WithJsonSchema({"enum": _CLONE_STAGES, "type": "string"}),
]


class CloneProgressEvent(BaseModel):
    """`clone-progress` — git source is being cloned; carries clone progress.

    A normal progress tick has `stage` + `percent`. A heartbeat during the
    silent promisor blob fetch instead carries `mb_on_disk` (and no percent),
    so the UI shows the working tree materializing rather than freezing."""

    # Server-computed display label (owner/repo or basename) so the UI shows a
    # friendly pending title without re-deriving it client-side.
    label: OptionalStr = None
    stage: _OptionalStage = None
    percent: OptionalInt = None
    mb_on_disk: OptionalInt = None


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


class ErrorCode(StrEnum):
    """Machine-readable discriminator on an `error` event. The client keys its
    remedy on this, never on the message text. Only failures the UI answers
    differently earn a member; everything else stays message-only."""

    REPO_NOT_FOUND = "repo-not-found"


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


class TimelineEvent(StrEnum):
    """SSE event names for the /api/timeline stream — the wire contract the
    frontend matches verbatim."""

    PROGRESS = "timeline-progress"
    COMPLETE = "timeline-complete"
    ERROR = "error"


class TimelineStage(StrEnum):
    """Which part of the timeline build a progress tick is reporting — the wire
    contract the frontend matches verbatim. Members are used everywhere instead
    of literals, like ScanEvent's."""

    FETCH = "fetch"
    HISTORY = "history"
    BLOBS = "blobs"
    ASSEMBLE = "assemble"


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
    `assemble` carries nothing but its own start, and runs until the bundle
    lands."""

    stage: _TimelineStage
    percent: OptionalInt = None
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
