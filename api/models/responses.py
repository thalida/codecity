"""Non-streaming JSON response bodies."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from api.core.constants import ErrorCode


class ErrorResponse(BaseModel):
    error: str
    # Set where the UI answers the failure differently. Same member set as the
    # stream's ErrorEvent, so a client keys on one vocabulary.
    code: ErrorCode | None = None


class FileTooLargeResponse(BaseModel):
    error: str
    size: int
    limit: int


class ContentPendingResponse(BaseModel):
    """202 body for GET /api/file: the content exists, this machine just doesn't
    have it yet. Deliberately not a 404 — a repo mid-fetch would answer a whole
    page of previews with them, and a burst of 404s from one client is what
    edge proxies read as scanning and start blocking."""

    status: Literal["pending"] = "pending"
    # Ready to show: the client renders it as-is under its own heading.
    message: str


class PendingBatchEntry(BaseModel):
    """A batched path whose bytes aren't downloaded yet. Named rather than
    omitted so the caller can leave its placeholder as-is: an omission means
    "fall back to the single-file GET", which for this path is a wasted request
    per building, and a building painted as failed when nothing failed."""

    status: Literal["pending"] = "pending"


class ImageBatchEntry(BaseModel):
    """One image in a POST /api/images batch response: its content-type and
    base64-encoded bytes, keyed by request path in the response map."""

    mime: str
    b64: str


class FingerprintEntry(BaseModel):
    """One binary file's byte-pattern fingerprint in a POST /api/fingerprints
    batch response: a base64-encoded grayscale PNG (image/png implied), keyed
    by request path. Computed server-side from the file's head — raw binary
    bytes never ship to the client."""

    b64: str


class HealthResponse(BaseModel):
    ok: bool


class ConfigResponse(BaseModel):
    allowLocalRepos: bool
    # `allowLocalRepos` alone can't say this: it is also false on a local
    # instance that simply hasn't mounted anything.
    hosted: bool
    maxBatchPaths: int
    version: str
    # The repo the landing renders behind itself; empty means no backdrop. Same
    # env var the Discover list flags, so the two can never disagree.
    featuredRepo: str


class DiscoverEntry(BaseModel):
    """One curated repo on the landing's Discover tab. Deliberately just a URL
    and a name: stars and scan timings were considered and rejected, so there
    is nothing here to rot or to fetch from a third party."""

    url: str
    label: str
    # At most one entry carries it, and the landing reads it from here rather
    # than a second config field that could disagree with the list.
    featured: bool = False


class DiscoverResponse(BaseModel):
    repos: list[DiscoverEntry]


class CommitDetailResponse(BaseModel):
    sha: str
    authors: list[str]
    date: str  # YYYY-MM-DD
    subject: str
    body: str


class BranchListResponse(BaseModel):
    branches: list[str]
    default: str | None
