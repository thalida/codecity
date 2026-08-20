"""GET /api/file — serve a file's bytes, restricted to scanned roots.

Optional `sha` selects a version: absent reads the working tree, present reads
that git blob, so a scrubbed Timeline commit shows its own content. POST
/api/images and /api/fingerprints are batch loaders for the scene, named for
what they return rather than as plurals of this.
"""

from __future__ import annotations

import base64
import mimetypes
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.core.config import MAX_BATCH_IMAGE_BYTES, MAX_BATCH_PATHS, MAX_FILE_BYTES
from api.models.responses import (
    ContentPendingResponse,
    ImageBatchEntry,
    FileTooLargeResponse,
    FingerprintEntry,
    PendingBatchEntry,
)
from api.core.security import NoRootsRegisteredError, OutsideRootError, TRUST
from api.utils.binfmt import FINGERPRINT_SAMPLE_BYTES, fingerprint_png
from api.git import BlobUnavailable, is_lfs_pointer, read_blob, read_lfs_pointer
from api.utils.media import is_media
from api.utils.shas import is_object_sha

router = APIRouter(prefix="/api", tags=["file"])


class PathBatchRequest(BaseModel):
    paths: list[str]
    # Timeline: path -> blob sha, so a scrubbed commit batches its own bytes
    # instead of HEAD's. Absent/unlisted paths read the working tree.
    shas: dict[str, str] | None = None


def _read_versioned(target: Path, sha: str | None) -> bytes | BlobUnavailable:
    """Bytes for a trust-resolved path: that git blob when `sha` is given, else
    the working tree. A BlobUnavailable instead says why there are none, and
    which kind of nothing it is (see BlobUnavailable). Callers decide how loud
    each one is.
    """
    if sha is None:
        if not target.is_file():
            return BlobUnavailable.MISSING
        body = target.read_bytes()
        if not is_lfs_pointer(body):
            return body
        # The stub means the checkout was never smudged, not that the object
        # is absent: `lfs fetch` downloads without touching the working tree.
        root = TRUST.root_for(target)
        resolved = read_lfs_pointer(root, body) if root else None
        return resolved or BlobUnavailable.PENDING
    if not is_object_sha(sha):
        return BlobUnavailable.MISSING
    root = TRUST.root_for(target)
    return read_blob(root, sha) if root else BlobUnavailable.MISSING


# The two pending reads wait on different fetches, and which one it is tells the
# reader whether waiting is worth it, so the copy names it.
_PENDING_WORKING_TREE = (
    "This file is stored in Git LFS and has not been downloaded yet. "
    "It will appear once the LFS fetch finishes."
)
_PENDING_BLOB = (
    "This version's content has not been downloaded yet. "
    "It will appear once the repo history finishes fetching."
)


@router.get(
    "/file",
    responses={
        202: {
            "model": ContentPendingResponse,
            "description": "Content not downloaded yet; retry later.",
        }
    },
)
def get_file(
    path: str = Query(..., description="Absolute path inside a scanned root"),
    sha: str | None = Query(
        None, description="Blob sha to read instead of the working tree"
    ),
) -> Response:
    if sha is not None and not is_object_sha(sha):
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
    if body is BlobUnavailable.PENDING:
        return JSONResponse(
            status_code=202,
            content=ContentPendingResponse(
                message=_PENDING_BLOB if sha else _PENDING_WORKING_TREE
            ).model_dump(),
            # The fetch it's waiting on lands without changing the URL, so a
            # cached "pending" would outlive the state it describes.
            headers={"Cache-Control": "no-store"},
        )
    if body is BlobUnavailable.MISSING:
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
        # A set Content-Encoding makes the app-wide GZipMiddleware skip this, so
        # already-compressed bytes aren't re-deflated for nothing.
        return Response(
            content=body,
            media_type=guessed,
            headers={"Content-Encoding": "identity"},
        )
    # Non-media (code, configs, extensionless) → text/plain so the preview
    # renders the bytes as code; GZipMiddleware compresses it (text gzips well).
    return Response(content=body, media_type="text/plain; charset=utf-8")


@router.post("/images")
def get_images(req: PathBatchRequest) -> dict[str, ImageBatchEntry | PendingBatchEntry]:
    """Batch image fetch — {path: {mime, b64}} for many small images in one round
    trip. NOT a plural of GET /api/file: it inlines base64, serves images only,
    and omits anything it can't serve. It exists so the scene's billboard loader
    doesn't exhaust the browser's HTTP/1.1 connection pool on a media-heavy repo.

    Each path is trust-checked exactly like GET /api/file. Paths that are out of
    root, missing, non-image, or larger than MAX_BATCH_IMAGE_BYTES are silently
    omitted; the client falls back to the streaming GET for those. One that
    isn't downloaded yet gets a PendingBatchEntry instead, because for it that
    fallback is a wasted request. Videos are never batched (they stream their
    poster frame), so this is images only.
    """
    out: dict[str, ImageBatchEntry | PendingBatchEntry] = {}
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
        if body is BlobUnavailable.PENDING:
            out[path] = PendingBatchEntry()
            continue
        if not isinstance(body, bytes) or len(body) > MAX_BATCH_IMAGE_BYTES:
            continue
        out[path] = ImageBatchEntry(mime=guessed, b64=base64.b64encode(body).decode())
    return out


@lru_cache(maxsize=512)
def _fingerprint_b64(path: str, mtime: float, size: int) -> str | None:
    """Base64 byte-pattern fingerprint PNG, memoized on (path, mtime, size) so an
    edit re-fingerprints and the facade + preview requests collapse to one. Reads
    only the head, so a multi-MB binary costs one small read.

    None for an undownloaded lfs pointer: its head is ASCII metadata, and a
    fingerprint of that is a picture of the stub worn as the file's own."""
    with open(path, "rb") as fh:
        head = fh.read(FINGERPRINT_SAMPLE_BYTES)
    if is_lfs_pointer(head):
        return None
    return base64.b64encode(fingerprint_png(head)).decode()


@router.post("/fingerprints")
def get_fingerprints(
    req: PathBatchRequest,
) -> dict[str, FingerprintEntry | PendingBatchEntry]:
    """Batch byte-pattern fingerprint fetch — {path: {b64}}, one round trip for
    many buildings. Trust-checked like GET /api/file; out-of-root / missing /
    unreadable paths are silently omitted, and one whose bytes aren't downloaded
    yet is named pending (see get_images). Raw binary bytes never leave the
    server — only the head is read, and only the fingerprint image returned."""
    out: dict[str, FingerprintEntry | PendingBatchEntry] = {}
    for path in req.paths[:MAX_BATCH_PATHS]:
        try:
            target = TRUST.assert_inside(Path(path))
        except (NoRootsRegisteredError, OutsideRootError, OSError, RuntimeError):
            continue
        if not target.is_file():
            continue
        try:
            st = target.stat()
            b64 = _fingerprint_b64(str(target), st.st_mtime, st.st_size)
        except OSError:
            continue
        out[path] = PendingBatchEntry() if b64 is None else FingerprintEntry(b64=b64)
    return out
