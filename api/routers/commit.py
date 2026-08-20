"""GET /api/commit?src=…&sha=<sha> — commit detail from that source's repo."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query

from api.models.responses import CommitDetailResponse
from api.git import ResolveError, SourceRef, build_authors_list, resolve_root, run_git

router = APIRouter(prefix="/api", tags=["commit"])

_SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")
_FMT = (
    "%H%x00%an%x00%aI%x00%s%x00"
    "%(trailers:key=Co-authored-by,valueonly,separator=%x1f)%x00%b"
)


@router.get("/commit", response_model=CommitDetailResponse)
def get_commit(
    src: str = Query(..., description="The manifest's `src`: whose history to read"),
    branch: str | None = Query(
        None, description="The manifest's `branch`, as it was passed to /api/manifest"
    ),
    sha: str = Query(...),
) -> CommitDetailResponse:
    if not _SHA_RE.match(sha.strip()):
        raise HTTPException(400, "invalid or missing sha")
    try:
        root = resolve_root(SourceRef(src, branch))
    except ResolveError as e:
        raise HTTPException(e.status, e.message)
    # Empty stdout covers every failure run_git swallows, and the short split
    # below rejects it the same way it rejects a partial line.
    out = run_git(root, "show", "-s", f"--format={_FMT}", sha.strip())
    parts = out.rstrip("\n").split("\x00", 5)
    if len(parts) < 6:
        raise HTTPException(404, "sha not found in this repo")
    full_sha, author, iso_date, subject, trailers_raw, body = parts
    return CommitDetailResponse(
        sha=full_sha,
        authors=build_authors_list(author, trailers_raw),
        date=iso_date[:10],
        subject=subject,
        body=body,
    )
