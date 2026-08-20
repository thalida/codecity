"""The wire vocabulary: event names and error codes the frontend matches
verbatim.

These are strings on the wire, so they are shared by every layer — the scanner
tags its emissions with them, git source resolution raises them, and the HTTP
layer names its SSE events after them. They live here rather than beside the
Pydantic event payloads in api/models/events.py because those payloads are an
HTTP concern and the layers underneath must not import upward to reach a
string constant.

Members are used everywhere instead of bare literals, so the set of legal
values is greppable and a typo fails at import rather than on the wire.
"""

from __future__ import annotations

from enum import StrEnum


class ScanEvent(StrEnum):
    """SSE event names for the /api/manifest stream. Values are the exact event
    strings. The two MANIFEST_* members double as scan_tree's emission `phase`
    (the router forwards the phase as the event name)."""

    CLONE_PROGRESS = "clone-progress"
    SCAN_PROGRESS = "scan-progress"
    MANIFEST_PARTIAL = "manifest-partial"
    MANIFEST_COMPLETE = "manifest-complete"
    ERROR = "error"


class ErrorCode(StrEnum):
    """Machine-readable discriminator on an `error` event or error response.
    The client keys its remedy on this, never on the message text. Only
    failures the UI answers differently earn a member; everything else stays
    message-only."""

    REPO_NOT_FOUND = "repo-not-found"


class TimelineEvent(StrEnum):
    """SSE event names for the /api/timeline stream."""

    PROGRESS = "timeline-progress"
    COMPLETE = "timeline-complete"
    ERROR = "error"


class CloneStage(StrEnum):
    """Which part of a git clone or fetch a progress tick is reporting.
    `updating` is git's checkout phase ("Updating files: N%")."""

    RECEIVING = "receiving"
    RESOLVING = "resolving"
    COUNTING = "counting"
    UPDATING = "updating"


class TimelineStage(StrEnum):
    """Which part of the timeline build a progress tick is reporting."""

    FETCH = "fetch"
    HISTORY = "history"
    BLOBS = "blobs"
    ASSEMBLE = "assemble"
