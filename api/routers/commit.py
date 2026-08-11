"""GET /api/commit?sha=<sha> — commit detail from any registered scan root."""

from __future__ import annotations

import re
import subprocess

from fastapi import APIRouter, HTTPException, Query

from api.models.responses import CommitDetailResponse
from api.security import TRUST
from api.git import build_authors_list

router = APIRouter(prefix="/api", tags=["commit"])

_SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")
_FMT = (
    "%H%x00%an%x00%aI%x00%s%x00"
    "%(trailers:key=Co-authored-by,valueonly,separator=%x1f)%x00%b"
)


@router.get("/commit", response_model=CommitDetailResponse)
def get_commit(sha: str = Query(...)) -> CommitDetailResponse:
    if not _SHA_RE.match(sha.strip()):
        raise HTTPException(400, "invalid or missing sha")
    roots = TRUST.snapshot()
    if not roots:
        raise HTTPException(
            404, "no scan root registered yet: fetch /api/manifest first"
        )
    for root in roots:
        try:
            out = subprocess.check_output(
                [
                    "git",
                    "-c",
                    "safe.directory=*",
                    "-C",
                    str(root),
                    "show",
                    "-s",
                    f"--format={_FMT}",
                    sha.strip(),
                ],
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except subprocess.CalledProcessError:
            continue
        parts = out.rstrip("\n").split("\x00", 5)
        if len(parts) < 6:
            continue
        full_sha, author, iso_date, subject, trailers_raw, body = parts
        return CommitDetailResponse(
            sha=full_sha,
            authors=build_authors_list(author, trailers_raw),
            date=iso_date[:10],
            subject=subject,
            body=body,
        )
    raise HTTPException(404, "sha not found in any registered scan root")
