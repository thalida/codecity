"""GET /api/file — serve a file from disk, restricted to scanned roots.

POST /api/files is the batch sibling used by the scene's media-texture loader:
one round trip for many small images instead of one request per billboard.
"""

from __future__ import annotations

import base64
import mimetypes
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.config import MAX_FILE_BYTES
from api.models.responses import (
    FileBatchEntry,
    FileTooLargeResponse,
    FingerprintEntry,
)
from api.security import NoRootsRegisteredError, OutsideRootError, TRUST
from api.services.binfmt import FINGERPRINT_SAMPLE_BYTES, fingerprint_png
from api.services.media import is_media

router = APIRouter(prefix="/api", tags=["file"])

# Caps for POST /api/files. The client chunks its requests, but a server-side
# bound keeps any single response from ballooning: at most this many paths, and
# only images up to this size are base64-inlined — anything larger or non-image
# is omitted so the client falls back to the streaming GET /api/file path.
_MAX_BATCH_PATHS = 64
_MAX_BATCH_FILE_BYTES = 8 * 1024 * 1024


class FileBatchRequest(BaseModel):
    paths: list[str]


@router.get("/file")
def get_file(
    path: str = Query(..., description="Absolute path inside a scanned root"),
) -> Response:
    try:
        target = TRUST.assert_inside(Path(path))
    except NoRootsRegisteredError:
        raise HTTPException(
            403, "no scan root registered yet: fetch /api/manifest first"
        )
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
    body = target.read_bytes()
    if is_media(guessed) and guessed:
        # Already-compressed media (image/video/audio/pdf): a set Content-
        # Encoding makes the app-wide GZipMiddleware skip it, so we don't burn
        # CPU re-deflating incompressible bytes for ~0 benefit. 'identity' =
        # the body is sent as-is (RFC 9110 §8.4.1).
        return Response(
            content=body,
            media_type=guessed,
            headers={"Content-Encoding": "identity"},
        )
    # Non-media (code, configs, extensionless) → text/plain so the preview
    # renders the bytes as code; GZipMiddleware compresses it (text gzips well).
    return Response(content=body, media_type="text/plain; charset=utf-8")


@router.post("/files")
def get_files(req: FileBatchRequest) -> dict[str, FileBatchEntry]:
    """Batch image fetch — return {path: {mime, b64}} for many small images in
    one round trip. The scene loads one billboard texture per media file; firing
    a separate GET per file exhausts the browser's HTTP/1.1 connection pool on
    media-heavy repos, so the loader coalesces image paths into POST batches.

    Each path is trust-checked exactly like GET /api/file. Paths that are out of
    root, missing, non-image, or larger than _MAX_BATCH_FILE_BYTES are silently
    omitted; the client falls back to the streaming GET for those. Videos are
    never batched (they stream their poster frame), so this is images only.
    """
    out: dict[str, FileBatchEntry] = {}
    for path in req.paths[:_MAX_BATCH_PATHS]:
        try:
            target = TRUST.assert_inside(Path(path))
        except (NoRootsRegisteredError, OutsideRootError, OSError, RuntimeError):
            continue
        if not target.is_file() or target.stat().st_size > _MAX_BATCH_FILE_BYTES:
            continue
        guessed, _ = mimetypes.guess_type(str(target))
        if not guessed or not guessed.startswith("image/"):
            continue
        out[path] = FileBatchEntry(
            mime=guessed, b64=base64.b64encode(target.read_bytes()).decode()
        )
    return out


@lru_cache(maxsize=512)
def _fingerprint_b64(path: str, mtime: float, size: int) -> str:
    """Compute (and memoize) a file's base64 byte-pattern fingerprint PNG. Keyed
    on (path, mtime, size) so an edited file re-fingerprints; only the file's
    head is read, so a multi-MB binary costs one small read regardless of size.
    Both the facade texture loader and the preview card hit this, so the cache
    collapses their duplicate requests."""
    with open(path, "rb") as fh:
        head = fh.read(FINGERPRINT_SAMPLE_BYTES)
    return base64.b64encode(fingerprint_png(head)).decode()


@router.post("/fingerprints")
def get_fingerprints(req: FileBatchRequest) -> dict[str, FingerprintEntry]:
    """Batch byte-pattern fingerprint fetch — return {path: {b64}} of a small
    grayscale PNG per binary file, one round trip for many buildings. The city's
    data-building facade loader and the preview data card both request these;
    raw binary bytes never leave the server (only the head is read, and only a
    fingerprint image is returned).

    Each path is trust-checked exactly like GET /api/file. Paths that are out of
    root, missing, or unreadable are silently omitted."""
    out: dict[str, FingerprintEntry] = {}
    for path in req.paths[:_MAX_BATCH_PATHS]:
        try:
            target = TRUST.assert_inside(Path(path))
        except (NoRootsRegisteredError, OutsideRootError, OSError, RuntimeError):
            continue
        if not target.is_file():
            continue
        try:
            st = target.stat()
            out[path] = FingerprintEntry(
                b64=_fingerprint_b64(str(target), st.st_mtime, st.st_size)
            )
        except OSError:
            continue
    return out
