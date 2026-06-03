"""GET /api/file — serve a file from disk, restricted to scanned roots."""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from api.config import MAX_FILE_BYTES
from api.models.responses import FileTooLargeResponse
from api.security import NoRootsRegisteredError, OutsideRootError, TRUST
from api.services.media import is_media

router = APIRouter(prefix="/api", tags=["file"])


@router.get("/file")
def get_file(path: str = Query(..., description="Absolute path inside a scanned root")) -> Response:  # pyright: ignore[reportUnusedFunction]
    try:
        target = TRUST.assert_inside(Path(path))
    except NoRootsRegisteredError:
        raise HTTPException(403, "no scan root registered yet — fetch /api/manifest first")
    except OutsideRootError:
        raise HTTPException(403, "outside scan root")
    except (OSError, RuntimeError):
        raise HTTPException(404, "not found")

    if not target.is_file():
        raise HTTPException(404, "not a file")

    size = target.stat().st_size
    if size > MAX_FILE_BYTES:
        return JSONResponse(
            status_code=413,
            content=FileTooLargeResponse(
                error="file too large", size=size, limit=MAX_FILE_BYTES
            ).model_dump(),
        )

    guessed, _ = mimetypes.guess_type(str(target))
    ctype = guessed if is_media(guessed) and guessed else "text/plain; charset=utf-8"
    return Response(content=target.read_bytes(), media_type=ctype)
