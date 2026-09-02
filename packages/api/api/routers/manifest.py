"""The manifest routes: GET /api/manifest (SSE stream), GET
/api/manifest/signature, GET /api/timeline (SSE stream).

Source classification/resolution lives in api.git.source; these are the
thin HTTP handlers over it. A ResolveError carries a status + message, plus a
code where the UI answers the failure differently: the signature route turns it
into an HTTPException, while the manifest and timeline SSE routes turn it into
an `error` event (EventSource can't read 4xx bodies)."""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from api.models.events import ScanStreamMessage
from api.models.manifest import Manifest, SignatureResponse
from api.cache import cache_load_newest_manifest
from api.git import (
    ResolveError,
    SourceKind,
    classify,
    clone_dir_for,
    resolve_local,
    resolve_source,
)
from api.scan import manifest_events, normalize_excludes, signature_tree

router = APIRouter(prefix="/api", tags=["manifest"])


logger = logging.getLogger("codecity.manifest")


@router.get("/manifest/signature", response_model=SignatureResponse)
def signature(
    src: str = Query(...),
    branch: str | None = Query(None),
    no_cache: bool = Query(False),
    exclude: list[str] = Query(default_factory=list),
) -> SignatureResponse:
    try:
        target = resolve_source(src, branch)
    except ResolveError as e:
        raise HTTPException(e.status, e.message)
    try:
        sig = signature_tree(
            str(target),
            use_cache=not no_cache,
            extra_exclude_paths=normalize_excludes(exclude),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"signature failed: {e}")
    return sig


@router.get(
    "/manifest/cached",
    response_model=Manifest,
    responses={404: {"description": "Nothing cached for this source."}},
)
def cached_manifest(
    src: str = Query(...),
    branch: str | None = Query(None),
) -> Any:
    """The newest manifest already on disk for this source, or 404. Never
    scans, never clones, never resolves a ref over the network.

    Backs the landing backdrop, which wants a city to show rather than a
    current one. Everything else wants the truth and goes to /api/manifest."""
    if not src:
        raise HTTPException(400, "missing 'src' query param")
    kind = classify(src)
    if kind is SourceKind.INVALID:
        raise HTTPException(400, "unrecognized source: pass a local path or a git URL")
    if kind is SourceKind.REMOTE:
        # The clone dir keys on the branch AS PASSED, so a repo first opened
        # without one lives elsewhere than the branch recorded for it later.
        roots = [clone_dir_for(src, branch)]
        if branch:
            roots.append(clone_dir_for(src, None))
    else:
        try:
            roots = [resolve_local(src)]
        except ResolveError:
            raise HTTPException(404, "nothing cached for this source")
    for root in roots:
        manifest = cache_load_newest_manifest(root)
        if manifest is not None:
            return manifest
    raise HTTPException(404, "nothing cached for this source")


@router.get(
    "/manifest",
    responses={
        200: {
            "description": (
                "Server-Sent Events stream (`text/event-stream`). Named events and "
                "their JSON `data` payloads: `clone-progress` (CloneProgressEvent), "
                "`scan-progress` (ScanProgressEvent), `manifest-partial` "
                "(PartialManifestEvent), `manifest-complete` (CompleteManifestEvent), "
                "`error` (ErrorEvent). The client closes the connection on "
                "`manifest-complete`/`error`. When `ref` is set, the manifest is "
                "reconstructed as of that commit instead of the working tree "
                "(a remote source still emits `clone-progress` if it isn't cloned "
                "yet, but never `scan-progress`/`manifest-partial` for the "
                "reconstruction itself — the city is already drawn, so a skeleton "
                "would flash placeholders)."
            ),
            "model": ScanStreamMessage,
        },
    },
)
async def manifest(
    request: Request,
    src: str = Query(""),
    branch: str | None = Query(None),
    no_cache: bool = Query(False),
    exclude: list[str] = Query(default_factory=list),
    ref: str | None = Query(None),
) -> EventSourceResponse:
    use_cache = not no_cache
    excludes = normalize_excludes(exclude)

    return EventSourceResponse(
        manifest_events(request, src, branch, use_cache, excludes, ref)
    )
