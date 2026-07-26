"""GET /api/file — serve a file from disk, restricted to scanned roots.

POST /api/files is the batch sibling used by the scene's media-texture loader.
GET /api/blob is the Timeline sibling: same bytes, addressed by blob sha, so a
scrubbed commit shows its own content instead of HEAD's.
"""

from __future__ import annotations

import base64
import mimetypes
import re
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
from api.services.gitobj import read_blob
from api.services.media import is_media

router = APIRouter(prefix="/api", tags=["file"])

# Caps for POST /api/files. The client chunks its requests, but a server-side
# bound keeps any single response from ballooning: at most this many paths, and
# only images up to this size are base64-inlined — anything larger or non-image
# is omitted so the client falls back to the streaming GET /api/file path.
_MAX_BATCH_PATHS = 64
_MAX_BATCH_FILE_BYTES = 8 * 1024 * 1024

_SHA_RE = re.compile(r"[0-9a-f]{40}")


class FileBatchRequest(BaseModel):
    paths: list[str]
    # Timeline: path -> blob sha, so a scrubbed commit batches its own bytes
    # instead of HEAD's. Absent/unlisted paths read the working tree.
    shas: dict[str, str] | None = None


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


@router.get("/blob")
def get_blob(
    path: str = Query(..., description="Absolute path inside a scanned root"),
    sha: str = Query(..., description="40-hex blob sha to read"),
) -> Response:
    """Bytes of a historical blob, for Timeline scrubbing.

    `path` is trust-checked exactly like GET /api/file, but does NOT have to
    exist: the whole point is serving a file as it stood at a past commit, and
    it may have been deleted or renamed since. It also picks the repo and the
    mime type. `sha` is what actually selects the content.
    """
    if not _SHA_RE.fullmatch(sha):
        raise HTTPException(400, "sha must be 40 hex characters")
    try:
        target = TRUST.assert_inside(Path(path), must_exist=False)
    except NoRootsRegisteredError:
        raise HTTPException(
            403, "no scan root registered yet: fetch /api/manifest first"
        )
    except (OutsideRootError, OSError, RuntimeError):
        raise HTTPException(403, "outside scan root")

    root = TRUST.root_for(target)
    if root is None:
        raise HTTPException(403, "outside scan root")

    body = read_blob(root, sha)
    if body is None:
        raise HTTPException(404, "no such blob")
    if len(body) > MAX_FILE_BYTES:
        return JSONResponse(
            status_code=413,
            content=FileTooLargeResponse(
                error="file too large", size=len(body), limit=MAX_FILE_BYTES
            ).model_dump(),
        )

    # Mime off the path's extension, same as GET /api/file — the blob itself
    # carries no name.
    guessed, _ = mimetypes.guess_type(str(target))
    if is_media(guessed) and guessed:
        return Response(
            content=body,
            media_type=guessed,
            headers={"Content-Encoding": "identity"},
        )
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
        sha = (req.shas or {}).get(path)
        try:
            target = TRUST.assert_inside(Path(path), must_exist=sha is None)
        except (NoRootsRegisteredError, OutsideRootError, OSError, RuntimeError):
            continue
        guessed, _ = mimetypes.guess_type(str(target))
        if not guessed or not guessed.startswith("image/"):
            continue
        if sha is not None:
            root = TRUST.root_for(target)
            if root is None or not _SHA_RE.fullmatch(sha):
                continue
            body = read_blob(root, sha)
            if body is None or len(body) > _MAX_BATCH_FILE_BYTES:
                continue
        else:
            if not target.is_file() or target.stat().st_size > _MAX_BATCH_FILE_BYTES:
                continue
            body = target.read_bytes()
        out[path] = FileBatchEntry(mime=guessed, b64=base64.b64encode(body).decode())
    return out


@lru_cache(maxsize=512)
def _fingerprint_b64(path: str, mtime: float, size: int) -> str:
    """Base64 byte-pattern fingerprint PNG, memoized on (path, mtime, size) so an
    edit re-fingerprints and the facade + preview requests collapse to one. Reads
    only the head, so a multi-MB binary costs one small read."""
    with open(path, "rb") as fh:
        head = fh.read(FINGERPRINT_SAMPLE_BYTES)
    return base64.b64encode(fingerprint_png(head)).decode()


@router.post("/fingerprints")
def get_fingerprints(req: FileBatchRequest) -> dict[str, FingerprintEntry]:
    """Batch byte-pattern fingerprint fetch — {path: {b64}}, one round trip for
    many buildings. Trust-checked like GET /api/file; out-of-root / missing /
    unreadable paths are silently omitted. Raw binary bytes never leave the
    server — only the head is read, and only the fingerprint image returned."""
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
