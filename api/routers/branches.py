"""GET /api/branches?src=<git-url> — remote branch list for the branch picker.

Remote git URLs only: local sources scan the working tree in place and ignore
branch, so there is nothing to choose. Uses git ls-remote (no clone) and reuses
the clone error taxonomy so failures map to clean HTTP statuses."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from api.models.events import CodedHTTPException, ErrorCode
from api.models.responses import BranchListResponse
from api.git import (
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    SourceKind,
    classify,
    list_remote_branches,
)

router = APIRouter(prefix="/api", tags=["branches"])


@router.get("/branches", response_model=BranchListResponse)
def get_branches(src: str = Query(...)) -> BranchListResponse:
    if classify(src) is not SourceKind.REMOTE:
        raise HTTPException(400, "branches are only available for remote git URLs")
    try:
        branches, default = list_remote_branches(src)
    except RepoNotFoundError as e:
        # Coded, not message-only: the picker keys its remedy on the code, and
        # this route is where an unreachable repo usually fails first.
        raise CodedHTTPException(404, str(e), ErrorCode.REPO_NOT_FOUND) from e
    except HostUnreachableError as e:
        raise HTTPException(502, str(e)) from e
    except CloneError as e:
        raise HTTPException(400, str(e)) from e
    return BranchListResponse(branches=branches, default=default)
