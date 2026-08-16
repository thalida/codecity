"""GET /api/file — serve a file's bytes, restricted to scanned roots.

Optional `sha` selects a version: absent reads the working tree, present reads
that git blob, so a scrubbed Timeline commit shows its own content. POST
/api/images and /api/fingerprints are batch loaders for the scene, named for
what they return rather than as plurals of this.
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

from api.core.config import MAX_BATCH_PATHS, MAX_FILE_BYTES
from api.models.responses import (
    ImageBatchEntry,
    FileTooLargeResponse,
    FingerprintEntry,
)
from api.core.security import NoRootsRegisteredError, OutsideRootError, TRUST
from api.utils.binfmt import FINGERPRINT_SAMPLE_BYTES, fingerprint_png
from api.git import read_blob
from api.utils.media import is_media

router = APIRouter(prefix="/api", tags=["file"])

# Bound on one batch response; omitted paths fall back to GET /api/file. Lives
# in config.py because /api/config publishes it.
_MAX_BATCH_IMAGE_BYTES = 8 * 1024 * 1024

_SHA_RE = re.compile(r"[0-9a-f]{40}")


class PathBatchRequest(BaseModel):
    paths: list[str]
    # Timeline: path -> blob sha, so a scrubbed commit batches its own bytes
    # instead of HEAD's. Absent/unlisted paths read the working tree.
    shas: dict[str, str] | None = None


def _read_versioned(target: Path, sha: str | None) -> bytes | None:
    """Bytes for a trust-resolved path: that git blob when `sha` is given, else
    the working tree. None when it can't be read — a malformed or unknown sha,
    a path outside every root, or nothing there. Callers decide how loud that is.
    """
    if sha is None:
        return target.read_bytes() if target.is_file() else None
    if not _SHA_RE.fullmatch(sha):
        return None
    root = TRUST.root_for(target)
    return read_blob(root, sha) if root else None


@router.get("/file")
def get_file(
    path: str = Query(..., description="Absolute path inside a scanned root"),
    sha: str | None = Query(
        None, description="Blob sha to read instead of the working tree"
    ),
) -> Response:
    if sha is not None and not _SHA_RE.fullmatch(sha):
        raise HTTPException(400, "sha must be 40 hex characters")
    try:
        # With a sha the path need not exist (it names a past commit's file);
        # `..` is still normalized, so containment holds either way.
        target = TRUST.assert_inside(Path(path), must_exist=sha is None)
    except NoRootsRegisteredError:
        raise HTTPException(
            403, "no scan root registered yet: fetch /api/manifest first"
        )
    except OutsideRootError:
        raise HTTPException(403, "outside scan root")
    except (OSError, RuntimeError):
        raise HTTPException(404, "not found")

    body = _read_versioned(target, sha)
    if body is None:
        raise HTTPException(404, "no such blob" if sha else "not a file")

    size = len(body)
    if size > MAX_FILE_BYTES:
        return JSONResponse(
            status_code=413,
            content=FileTooLargeResponse(
                error="file too large", size=size, limit=MAX_FILE_BYTES
            ).model_dump(),
        )

    # Mime comes off the path's extension either way — a blob carries no name.
    guessed, _ = mimetypes.guess_type(str(target))
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


@router.post("/images")
def get_images(req: PathBatchRequest) -> dict[str, ImageBatchEntry]:
    """Batch image fetch — {path: {mime, b64}} for many small images in one round
    trip. NOT a plural of GET /api/file: it inlines base64, serves images only,
    and omits anything it can't serve. It exists so the scene's billboard loader
    doesn't exhaust the browser's HTTP/1.1 connection pool on a media-heavy repo.

    Each path is trust-checked exactly like GET /api/file. Paths that are out of
    root, missing, non-image, or larger than _MAX_BATCH_IMAGE_BYTES are silently
    omitted; the client falls back to the streaming GET for those. Videos are
    never batched (they stream their poster frame), so this is images only.
    """
    out: dict[str, ImageBatchEntry] = {}
    for path in req.paths[:MAX_BATCH_PATHS]:
        sha = (req.shas or {}).get(path)
        try:
            target = TRUST.assert_inside(Path(path), must_exist=sha is None)
        except (NoRootsRegisteredError, OutsideRootError, OSError, RuntimeError):
            continue
        guessed, _ = mimetypes.guess_type(str(target))
        if not guessed or not guessed.startswith("image/"):
            continue
        body = _read_versioned(target, sha)
        if body is None or len(body) > _MAX_BATCH_IMAGE_BYTES:
            continue
        out[path] = ImageBatchEntry(mime=guessed, b64=base64.b64encode(body).decode())
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
def get_fingerprints(req: PathBatchRequest) -> dict[str, FingerprintEntry]:
    """Batch byte-pattern fingerprint fetch — {path: {b64}}, one round trip for
    many buildings. Trust-checked like GET /api/file; out-of-root / missing /
    unreadable paths are silently omitted. Raw binary bytes never leave the
    server — only the head is read, and only the fingerprint image returned."""
    out: dict[str, FingerprintEntry] = {}
    for path in req.paths[:MAX_BATCH_PATHS]:
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
