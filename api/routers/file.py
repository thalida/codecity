"""GET /api/file — serve a file's bytes from inside one source's repo.

A read names its file the way the manifest does: the `src` (+ `branch`) the
manifest was built for, and a path relative to that repo's root. The server
resolves the root, so no absolute path is ever on the wire and a read outlives
the process that scanned it.

Optional `sha` selects a version: absent reads the working tree, present reads
that git blob, so a scrubbed Timeline commit shows its own content.

One request per file, including the hundreds a media-heavy city asks for at
once. That used to be batched into a JSON POST because HTTP/1.1 allows six
connections per origin; browsers reach this over HTTP/2, which multiplexes them
on one. Batching binary through JSON cost base64 inflation, a whole-response
buffer on both ends, a size cap with a fallback path around it, and — worst —
one opaque cache entry, so every rebuild refetched every image instead of
revalidating each on its own.

GET /api/fingerprint is a sibling, not a plural: it returns a byte-pattern image
computed here, so raw binary never leaves the machine.
"""

from __future__ import annotations

import mimetypes
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from api.core.config import MAX_FILE_BYTES
from api.models.responses import (
    ContentPendingResponse,
    FileTooLargeResponse,
)
from api.utils.binfmt import FINGERPRINT_SAMPLE_BYTES, fingerprint_png
from api.git import (
    BlobUnavailable,
    ResolveError,
    SourceRef,
    is_lfs_pointer,
    read_blob,
    read_lfs_pointer,
    get_repo_root,
    within,
)
from api.utils.media import is_media
from api.utils.shas import is_object_sha

router = APIRouter(prefix="/api", tags=["file"])

# A versioned URL (mtime or blob sha) names one immutable body, so it can be
# cached outright; bare, it means "whatever is there now" and must not stick.
_CACHE_IMMUTABLE = "public, max-age=31536000, immutable"
_CACHE_REVALIDATE = "no-cache"


def _cache_control(versioned: bool) -> str:
    return _CACHE_IMMUTABLE if versioned else _CACHE_REVALIDATE


def _resolve(
    src: str, branch: str | None, path: str, *, must_exist: bool = True
) -> tuple[Path, Path]:
    """(repo root, file) for a source-relative read, or the refusal that keeps
    this endpoint inside that one repo."""
    try:
        root = get_repo_root(SourceRef(src, branch))
        return root, within(root, path, must_exist=must_exist)
    except ResolveError as e:
        raise HTTPException(e.status, e.message)


def _pending(message: str) -> JSONResponse:
    """202, not 404: the content exists, this machine doesn't have it yet. A
    repo mid-fetch would answer a whole page of previews 404, and a burst of
    those from one client is what gets that client blocked."""
    return JSONResponse(
        status_code=202,
        content=ContentPendingResponse(message=message).model_dump(),
        # The fetch it waits on lands without changing the URL, so a cached
        # "pending" would outlive the state it describes.
        headers={"Cache-Control": "no-store"},
    )


def _read_versioned(
    root: Path, target: Path, sha: str | None
) -> bytes | BlobUnavailable:
    """Bytes for a resolved path: that git blob when `sha` is given, else
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
        return read_lfs_pointer(root, body) or BlobUnavailable.PENDING
    if not is_object_sha(sha):
        return BlobUnavailable.MISSING
    return read_blob(root, sha)


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
    src: str = Query(..., description="The manifest's `src`: which repo to read from"),
    branch: str | None = Query(
        None, description="The manifest's `branch`, as it was passed to /api/manifest"
    ),
    path: str = Query(..., description="Path relative to that repo's root"),
    sha: str | None = Query(
        None, description="Blob sha to read instead of the working tree"
    ),
    mtime: str | None = Query(
        None, description="Version marker; never read, only cached against"
    ),
) -> Response:
    if sha is not None and not is_object_sha(sha):
        raise HTTPException(400, "sha must be 40 hex characters")
    # With a sha the path need not exist (it names a past commit's file); `..`
    # is still normalized, so containment holds either way.
    root, target = _resolve(src, branch, path, must_exist=sha is None)

    body = _read_versioned(root, target, sha)
    if body is BlobUnavailable.PENDING:
        return _pending(_PENDING_BLOB if sha else _PENDING_WORKING_TREE)
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

    cache = _cache_control(bool(sha or mtime))
    # Mime comes off the path's extension either way — a blob carries no name.
    guessed, _ = mimetypes.guess_type(str(target))
    if is_media(guessed) and guessed:
        # A set Content-Encoding makes the app-wide GZipMiddleware skip this, so
        # already-compressed bytes aren't re-deflated for nothing.
        return Response(
            content=body,
            media_type=guessed,
            headers={"Content-Encoding": "identity", "Cache-Control": cache},
        )
    # Non-media (code, configs, extensionless) → text/plain so the preview
    # renders the bytes as code; GZipMiddleware compresses it (text gzips well).
    return Response(
        content=body,
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": cache},
    )


@router.get(
    "/fingerprint",
    responses={
        202: {
            "model": ContentPendingResponse,
            "description": "Content not downloaded yet; retry later.",
        }
    },
)
def get_fingerprint(
    src: str = Query(..., description="The manifest's `src`: which repo to read from"),
    branch: str | None = Query(
        None, description="The manifest's `branch`, as it was passed to /api/manifest"
    ),
    path: str = Query(..., description="Path relative to that repo's root"),
    mtime: str | None = Query(
        None, description="Version marker; never read, only cached against"
    ),
) -> Response:
    """A binary file's byte-pattern fingerprint as a PNG. Resolved exactly
    like GET /api/file. Raw binary bytes never leave the server: only the head is
    read, and only the image computed from it is returned."""
    _root, target = _resolve(src, branch, path)
    if not target.is_file():
        raise HTTPException(404, "not a file")

    try:
        st = target.stat()
        png = _fingerprint_png(str(target), st.st_mtime, st.st_size)
    except OSError:
        raise HTTPException(404, "not readable")
    if png is None:
        return _pending(_PENDING_WORKING_TREE)

    # Content-Encoding set so GZipMiddleware skips it: a PNG is already deflated.
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Content-Encoding": "identity",
            "Cache-Control": _cache_control(bool(mtime)),
        },
    )


@lru_cache(maxsize=512)
def _fingerprint_png(path: str, mtime: float, size: int) -> bytes | None:
    """Byte-pattern fingerprint PNG, memoized on (path, mtime, size) so an edit
    re-fingerprints and the facade + preview requests collapse to one. Reads only
    the head, so a multi-MB binary costs one small read.

    None for an undownloaded lfs pointer: its head is ASCII metadata, and a
    fingerprint of that is a picture of the stub worn as the file's own."""
    with open(path, "rb") as fh:
        head = fh.read(FINGERPRINT_SAMPLE_BYTES)
    if is_lfs_pointer(head):
        return None
    return fingerprint_png(head)
