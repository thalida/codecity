"""Non-streaming JSON response bodies."""

from __future__ import annotations

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error: str


class FileTooLargeResponse(BaseModel):
    error: str
    size: int
    limit: int


class FileBatchEntry(BaseModel):
    """One image in a POST /api/files batch response: its content-type and
    base64-encoded bytes, keyed by request path in the response map."""

    mime: str
    b64: str


class HealthResponse(BaseModel):
    ok: bool


class ConfigResponse(BaseModel):
    allowLocalRepos: bool


class CacheClearResponse(BaseModel):
    deleted: int


class CommitDetailResponse(BaseModel):
    sha: str
    authors: list[str]
    date: str  # YYYY-MM-DD
    subject: str
    body: str


class BranchListResponse(BaseModel):
    branches: list[str]
    default: str | None
