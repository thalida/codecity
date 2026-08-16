"""The manifest routes: GET /api/manifest (SSE stream), GET
/api/manifest/signature, GET /api/timeline (SSE stream).

Source classification/resolution lives in api.git.source; these are the
thin HTTP handlers over it. A ResolveError carries a status + message, plus a
code where the UI answers the failure differently: the signature route turns it
into an HTTPException, while the manifest and timeline SSE routes turn it into
an `error` event (EventSource can't read 4xx bodies)."""

from __future__ import annotations

import asyncio
import logging
import threading
from pathlib import Path
from typing import Any, AsyncIterator, Union

from fastapi import APIRouter, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from api.core.constants import ErrorCode, ScanEvent
from api.routers import sse
from api.routers.sse import Put, stream
from api.utils.labels import label_from_source
from api.models.events import (
    CloneProgressEvent,
    CompleteManifestEvent,
    ErrorEvent,
    PartialManifestEvent,
    ScanProgressEvent,
)
from api.models.manifest import Manifest, SignatureResponse
from api.core.security import TRUST
from api.cache import (
    cache_clear_timeline,
    cache_load_manifest,
    cache_load_newest_manifest,
    cache_load_ref_manifest,
    cache_save_manifest,
    cache_save_ref_manifest,
)
from api.git import (
    BranchNotFoundError,
    CloneProgress,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    ResolveError,
    SourceKind,
    classify,
    clone_dir_for,
    ensure_clone,
    resolve_local,
    resolve_ref,
    resolve_source,
)
from api.scan import (
    ScanCancelledError,
    normalize_excludes,
    reconstruct_manifest,
    scan_tree,
    signature_tree,
)

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


# Naming all five in `responses` registers each as a schema component, and
# transitively pulls Manifest -> tree types in behind the manifest events.
SSEEvent = Union[
    CloneProgressEvent,
    ScanProgressEvent,
    PartialManifestEvent,
    CompleteManifestEvent,
    ErrorEvent,
]


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
            "model": SSEEvent,
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

    async def gen() -> AsyncIterator[dict[str, Any]]:
        # Validate WITHOUT cloning: the clone runs on the worker below so its
        # progress streams. Failures here are error EVENTS, not 4xx.
        if not src:
            yield sse.error("missing 'src' query param")
            return
        kind = classify(src)
        if kind is SourceKind.INVALID:
            yield sse.error("unrecognized source: pass a local path or a git URL")
            return
        # The PENDING label, and the only name derivation in this route: the
        # scanner bakes the canonical tree.name later. See the README.
        pending_label = label_from_source(src)
        local_path: Path | None = None
        if kind is SourceKind.LOCAL:
            try:
                local_path = await asyncio.to_thread(resolve_local, src)
            except ResolveError as e:
                yield sse.error(e.message, e.code)
                return

        built: dict[str, Any] = {"manifest": None, "sig": None, "path": None}

        def work(_put: Put, cancel: threading.Event) -> None:
            def _on_clone(p: CloneProgress) -> None:
                _put(
                    sse.event(
                        ScanEvent.CLONE_PROGRESS,
                        {
                            "label": pending_label,
                            "stage": p.stage,
                            "percent": p.percent,
                            "objects": p.objects,
                            "objects_total": p.objects_total,
                            "mib": p.mib,
                        },
                    )
                )

            def _on_clone_heartbeat(mb_on_disk: int | None) -> None:
                # Silent promisor-fetch phase: no stage/percent, just the working
                # tree growing on disk, so the UI shows activity not a freeze.
                _put(
                    sse.event(
                        ScanEvent.CLONE_PROGRESS,
                        {"label": pending_label, "mb_on_disk": mb_on_disk},
                    )
                )

            def _on_scan(files_scanned: int) -> None:
                _put(
                    sse.event(
                        ScanEvent.SCAN_PROGRESS,
                        {"label": pending_label, "files_scanned": files_scanned},
                    )
                )

            try:
                # Clone phase (git only): emit `clone-progress` FIRST, then clone
                # with live progress + cancel support.
                if kind is SourceKind.REMOTE:
                    _put(sse.event(ScanEvent.CLONE_PROGRESS, {"label": pending_label}))
                    try:
                        path = ensure_clone(
                            src,
                            branch,
                            on_progress=_on_clone,
                            on_heartbeat=_on_clone_heartbeat,
                            cancel_event=cancel,
                        )
                    except RepoNotFoundError as e:
                        _put(sse.error(str(e), ErrorCode.REPO_NOT_FOUND))
                        return
                    except (BranchNotFoundError, HostUnreachableError) as e:
                        _put(sse.error(str(e)))
                        return
                    except CloneError as e:
                        _put(sse.error(str(e)))
                        return
                else:
                    assert local_path is not None
                    path = local_path

                built["path"] = path
                TRUST.register(path)

                # no_cache means rebuild EVERYTHING for this source, so the
                # per-HEAD timeline bundle has to go too.
                if not use_cache:
                    cache_clear_timeline(path.resolve())

                # Resolve to a sha FIRST: it is both the cache key and the
                # early "bad ref" error. No skeleton events — see the README.
                if ref is not None:
                    sha = resolve_ref(path, ref)
                    if sha is None:
                        _put(sse.error(f"ref does not resolve to a commit: {ref}"))
                        return
                    if use_cache:
                        cached_ref = cache_load_ref_manifest(path.resolve(), sha)
                        if cached_ref is not None:
                            _put(
                                sse.event(
                                    ScanEvent.MANIFEST_COMPLETE,
                                    {"manifest": cached_ref},
                                )
                            )
                            return
                    m = reconstruct_manifest(str(path), sha, use_cache=use_cache)
                    cache_save_ref_manifest(path.resolve(), sha, m)
                    _put(sse.event(ScanEvent.MANIFEST_COMPLETE, {"manifest": m}))
                    return

                _put(sse.event(ScanEvent.SCAN_PROGRESS, {"label": pending_label}))

                # The signature costs a full stat-walk and scan_tree computes
                # the same value anyway, so only pay when a cache exists.
                if use_cache:
                    sig = signature_tree(
                        str(path), use_cache=use_cache, extra_exclude_paths=excludes
                    ).content_signature
                    built["sig"] = sig
                    cached = cache_load_manifest(path.resolve(), sig)
                    if cached is not None:
                        _put(
                            sse.event(ScanEvent.MANIFEST_COMPLETE, {"manifest": cached})
                        )
                        return

                # Cold scan: partial + complete manifests, with heartbeat progress.
                for ev in scan_tree(
                    str(path),
                    use_cache=use_cache,
                    cancel_event=cancel,
                    on_scan_progress=_on_scan,
                    extra_exclude_paths=excludes,
                ):
                    if ev.phase is ScanEvent.MANIFEST_COMPLETE:
                        built["manifest"] = ev.manifest
                        built["sig"] = ev.manifest.content_signature
                    _put(sse.event(ev.phase, {"manifest": ev.manifest}))
            except ScanCancelledError:
                pass  # client disconnected mid-clone/scan; nothing to report
            except Exception as e:  # noqa: BLE001
                logger.exception("manifest scan failed for src=%s", src)
                _put(sse.error(f"scan failed: {e}"))
            finally:
                _put(None)  # sentinel

        async def save() -> None:
            """Write-through on a clean finish; the read is gated by no_cache,
            the write never is. Nothing to save when the scan errored."""
            final, sig, path = built["manifest"], built["sig"], built["path"]
            if final is not None and sig is not None and path is not None:
                await asyncio.to_thread(cache_save_manifest, path.resolve(), sig, final)

        async for item in stream(request, work, on_complete=save):
            yield item

    return EventSourceResponse(gen())
