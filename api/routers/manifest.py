"""The manifest routes: GET /api/manifest (SSE stream), GET
/api/manifest/signature, GET /api/timeline (SSE stream), DELETE
/api/manifest/cache.

Source classification/resolution lives in api.services.source; these are the
thin HTTP handlers over it. A ResolveError carries a status + message: the
signature/cache routes turn it into an HTTPException, while the manifest and
timeline SSE routes turn it into an `error` event (EventSource can't read 4xx
bodies)."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from pathlib import Path
from typing import Any, AsyncIterator, Union

from fastapi import APIRouter, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from api.models.events import (
    CloneProgressEvent,
    CompleteManifestEvent,
    ErrorEvent,
    PartialManifestEvent,
    ScanEvent,
    ScanProgressEvent,
    TimelineCompleteEvent,
    TimelineEvent,
    TimelineProgressEvent,
)
from api.models.manifest import SignatureResponse
from api.models.responses import CacheClearResponse
from api.security import TRUST
from api.services.cache import (
    cache_clear_all,
    cache_load_manifest,
    cache_load_ref_manifest,
    cache_load_timeline,
    cache_save_manifest,
    cache_save_ref_manifest,
    cache_save_timeline,
)
from api.services.clone import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    clone_dir_for,
    ensure_clone,
    hydrate_blobs,
    remove_clone,
)
from api.services.gitobj import resolve_ref
from api.services.scan import (
    NotAGitRepoError,
    ScanCancelledError,
    reconstruct_manifest,
    scan_tree,
    signature_tree,
)
from api.services.source import (
    ResolveError,
    SourceKind,
    classify,
    label_from_source,
    resolve_local,
    resolve_source,
)
from api.services.timeline import build_timeline_bundle

router = APIRouter(prefix="/api", tags=["manifest"])


logger = logging.getLogger("codecity.manifest")


def _norm_excludes(exclude: list[str]) -> frozenset[str]:
    """Normalize repeated ?exclude= params to root-anchored rel-paths:
    trim whitespace, drop empties, strip a single leading '/'."""
    return frozenset(e.strip().lstrip("/") for e in exclude if e.strip())


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
            extra_exclude_paths=_norm_excludes(exclude),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"signature failed: {e}")
    return SignatureResponse.model_validate(dict(sig))


TimelineSSEEvent = Union[TimelineProgressEvent, TimelineCompleteEvent, ErrorEvent]


@router.get(
    "/timeline",
    responses={
        200: {
            "description": (
                "Server-Sent Events stream (`text/event-stream`). Named events "
                "and their JSON `data` payloads: `timeline-progress` "
                "(TimelineProgressEvent, one or more while the history walk / "
                "blob resolution run), `timeline-complete` (TimelineCompleteEvent, "
                "the full bundle), `error` (ErrorEvent). A warm cache hit emits "
                "only `timeline-complete`, no progress. The client closes the "
                "connection on `timeline-complete`/`error`."
            ),
            "model": TimelineSSEEvent,
        },
    },
)
async def timeline(
    request: Request,
    src: str = Query(...),
    branch: str | None = Query(None),
    no_cache: bool = Query(False),
) -> EventSourceResponse:
    use_cache = not no_cache
    pending_label = label_from_source(src)

    is_remote = classify(src) is SourceKind.REMOTE

    async def gen() -> AsyncIterator[dict[str, Any]]:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        holder: dict[str, Any] = {"bundle": None, "path": None, "head": None}
        cancel = threading.Event()

        def _put(item: dict[str, Any] | None) -> None:
            loop.call_soon_threadsafe(q.put_nowait, item)

        def _on_progress(payload: dict[str, Any]) -> None:
            stage = payload["stage"]
            data: dict[str, Any] = {"stage": stage, "label": pending_label}
            if stage == "history":
                data["commits"] = payload.get("commits")
            else:  # "blobs"
                data["blobsDone"] = payload.get("done")
                data["blobsTotal"] = payload.get("total")
            _put(_sse(TimelineEvent.PROGRESS, data))

        def _on_hydrate(payload: tuple[str, int]) -> None:
            # git fetch (stage, percent) → the "downloading history" tick.
            _put(
                _sse(
                    TimelineEvent.PROGRESS,
                    {"stage": "fetch", "percent": payload[1], "label": pending_label},
                )
            )

        def _run() -> None:
            try:
                try:
                    target = resolve_source(src, branch)
                except ResolveError as e:
                    _put(_sse_error(e.message))
                    return
                holder["path"] = target
                head = resolve_ref(target, "HEAD")
                holder["head"] = head
                if use_cache and head is not None:
                    cached = cache_load_timeline(target.resolve(), head)
                    if cached is not None:
                        _put(_sse(TimelineEvent.COMPLETE, {"bundle": cached}))
                        return
                # A blobless remote clone has no historical blob content — backfill
                # it before the walk so blob resolution reads local objects (no
                # per-blob promisor fetch hang). Never touches a local repo.
                if is_remote:
                    hydrate_blobs(target, on_progress=_on_hydrate, cancel_event=cancel)
                bundle = build_timeline_bundle(
                    str(target), use_cache=use_cache, on_progress=_on_progress
                )
                holder["bundle"] = bundle
                _put(_sse(TimelineEvent.COMPLETE, {"bundle": bundle}))
            except ScanCancelledError:
                pass  # client disconnected mid-hydrate; nothing to report
            except NotAGitRepoError as e:
                _put(_sse_error(str(e)))
            except Exception as e:  # noqa: BLE001
                logger.exception("timeline build failed for src=%s", src)
                _put(_sse_error(f"timeline failed: {e}"))
            finally:
                _put(None)  # sentinel

        worker = threading.Thread(target=_run, daemon=True)
        worker.start()

        disconnected = False
        try:
            while True:
                if await request.is_disconnected():
                    disconnected = True
                    cancel.set()  # kill an in-flight hydrate fetch
                    break
                try:
                    item = await asyncio.wait_for(q.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                if item is None:
                    break
                yield item
        finally:
            cancel.set()
            await asyncio.to_thread(worker.join, 2.0)

        # ALWAYS write cache on a clean final (read gated by no_cache; write is
        # not). Skipped on disconnect, and on error (where bundle stays None).
        bundle = holder["bundle"]
        path = holder["path"]
        head = holder["head"]
        if (
            bundle is not None
            and not disconnected
            and path is not None
            and head is not None
        ):
            await asyncio.to_thread(cache_save_timeline, path.resolve(), head, bundle)

    return EventSourceResponse(gen())


@router.delete("/manifest/cache", response_model=CacheClearResponse)
def clear_cache(
    src: str = Query(...),
    branch: str | None = Query(None),
) -> CacheClearResponse:
    if not src:
        raise HTTPException(400, "missing 'src' query param")
    kind = classify(src)
    if kind is SourceKind.INVALID:
        raise HTTPException(400, "unrecognized source: pass a local path or a git URL")
    if kind is SourceKind.REMOTE:
        abs_root = clone_dir_for(src, branch)
    else:
        # Non-strict resolve so a recents entry for a since-deleted path
        # still drops its cache.
        abs_root = Path(src).resolve(strict=False)
    # Full clean slate for this source: every per-root cache (manifest,
    # file-stat, git-history). For a REMOTE source also delete the clone working
    # tree so a re-add re-clones from scratch — the recovery path for a corrupt
    # clone. Hold the clone lock so we never rmtree a clone a concurrent request
    # is mid-clone into.
    deleted = cache_clear_all(abs_root)
    if kind is SourceKind.REMOTE:
        with TRUST.clone_lock:
            remove_clone(src, branch)
    return CacheClearResponse(deleted=deleted)


def _sse(event: "ScanEvent | TimelineEvent", payload: dict[str, Any]) -> dict[str, Any]:
    """sse-starlette event dict: {'event': name, 'data': json-string}. Both
    StrEnums serialize to their wire string ('manifest-complete', 'timeline-
    progress', …)."""
    return {"event": event, "data": json.dumps(payload)}


def _sse_error(message: str) -> dict[str, Any]:
    """An `error` SSE event, single-sourced through the ErrorEvent model."""
    return _sse(ScanEvent.ERROR, ErrorEvent(error=message).model_dump())


# Documented SSE event union: surfacing all five event models in the
# OpenAPI `responses` registers each as a schema component (richer Scalar
# docs) AND transitively pulls Manifest -> tree types via the manifest events.
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
    excludes = _norm_excludes(exclude)

    async def gen() -> AsyncIterator[dict[str, Any]]:
        # Classify + (for local) validate WITHOUT cloning. The git clone runs
        # on the worker thread below so its progress streams live and a
        # mid-clone disconnect cancels it. Failures become error EVENTS, not
        # 4xx (EventSource can't read 4xx bodies).
        if not src:
            yield _sse_error("missing 'src' query param")
            return
        kind = classify(src)
        if kind is SourceKind.INVALID:
            yield _sse_error("unrecognized source: pass a local path or a git URL")
            return
        # The PENDING label — the ONLY name derivation left in this route. Before
        # the repo is scanned, `src` is all we have; the scanner bakes the
        # canonical tree.name later (from the git remote). Emitted on progress
        # events so the client shows a name during load without re-deriving it.
        pending_label = label_from_source(src)
        local_path: Path | None = None
        if kind is SourceKind.LOCAL:
            try:
                local_path = await asyncio.to_thread(resolve_local, src)
            except ResolveError as e:
                yield _sse_error(e.message)
                return

        cancel = threading.Event()
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        holder: dict[str, Any] = {"manifest": None, "sig": None, "path": None}

        def _put(item: dict[str, Any] | None) -> None:
            loop.call_soon_threadsafe(q.put_nowait, item)

        def _on_clone(payload: tuple[str, int]) -> None:
            stage, percent = payload
            _put(
                _sse(
                    ScanEvent.CLONE_PROGRESS,
                    {
                        "label": pending_label,
                        "stage": stage,
                        "percent": percent,
                    },
                )
            )

        def _on_clone_heartbeat(mb_on_disk: int | None) -> None:
            # Silent promisor-fetch phase: no stage/percent, just the working
            # tree growing on disk, so the UI shows activity instead of freezing.
            _put(
                _sse(
                    ScanEvent.CLONE_PROGRESS,
                    {"label": pending_label, "mb_on_disk": mb_on_disk},
                )
            )

        def _on_scan(files_scanned: int) -> None:
            _put(
                _sse(
                    ScanEvent.SCAN_PROGRESS,
                    {"label": pending_label, "files_scanned": files_scanned},
                )
            )

        def _run() -> None:
            try:
                # Clone phase (git only): emit `clone-progress` FIRST, then clone
                # with live progress + cancel support.
                if kind is SourceKind.REMOTE:
                    _put(_sse(ScanEvent.CLONE_PROGRESS, {"label": pending_label}))
                    try:
                        with TRUST.clone_lock:
                            path = ensure_clone(
                                src,
                                branch,
                                on_progress=_on_clone,
                                on_heartbeat=_on_clone_heartbeat,
                                cancel_event=cancel,
                            )
                    except (
                        BranchNotFoundError,
                        RepoNotFoundError,
                        HostUnreachableError,
                    ) as e:
                        _put(_sse_error(str(e)))
                        return
                    except CloneError as e:
                        _put(_sse_error(str(e)))
                        return
                else:
                    assert local_path is not None
                    path = local_path

                holder["path"] = path
                TRUST.register(path)

                # Time-travel: reconstruct the manifest as of `ref` instead of
                # scanning the working tree. Resolve to a sha FIRST — it's both
                # the cache key and the early "bad ref" error, and it keeps only
                # a validated sha flowing into reconstruct_manifest (which
                # re-validates internally too, so this is defense-in-depth, not
                # the sole guard). No skeleton events: the city is already
                # drawn for the live tree, so scan-progress/manifest-partial
                # would just flash placeholders over it.
                if ref is not None:
                    sha = resolve_ref(path, ref)
                    if sha is None:
                        _put(_sse_error(f"ref does not resolve to a commit: {ref}"))
                        return
                    if use_cache:
                        cached_ref = cache_load_ref_manifest(path.resolve(), sha)
                        if cached_ref is not None:
                            _put(
                                _sse(
                                    ScanEvent.MANIFEST_COMPLETE,
                                    {"manifest": cached_ref},
                                )
                            )
                            return
                    m = reconstruct_manifest(str(path), sha, use_cache=use_cache)
                    cache_save_ref_manifest(path.resolve(), sha, m)
                    _put(_sse(ScanEvent.MANIFEST_COMPLETE, {"manifest": m}))
                    return

                _put(_sse(ScanEvent.SCAN_PROGRESS, {"label": pending_label}))

                # Signature (cache key) + warm-cache short-circuit.
                sig = signature_tree(
                    str(path), use_cache=use_cache, extra_exclude_paths=excludes
                )["content_signature"]
                holder["sig"] = sig
                if use_cache:
                    cached = cache_load_manifest(path.resolve(), sig)
                    if cached is not None:
                        _put(_sse(ScanEvent.MANIFEST_COMPLETE, {"manifest": cached}))
                        return

                # Cold scan: partial + complete manifests, with heartbeat progress.
                for ev in scan_tree(
                    str(path),
                    use_cache=use_cache,
                    cancel_event=cancel,
                    on_scan_progress=_on_scan,
                    extra_exclude_paths=excludes,
                ):
                    phase = ev["phase"]  # ScanEvent.MANIFEST_PARTIAL | _COMPLETE
                    m = ev["manifest"]
                    if phase is ScanEvent.MANIFEST_COMPLETE:
                        holder["manifest"] = m
                    _put(_sse(phase, {"manifest": m}))
            except ScanCancelledError:
                pass  # client disconnected mid-clone/scan; nothing to report
            except Exception as e:  # noqa: BLE001
                logger.exception("manifest scan failed for src=%s", src)
                _put(_sse_error(f"scan failed: {e}"))
            finally:
                _put(None)  # sentinel

        worker = threading.Thread(target=_run, daemon=True)
        worker.start()

        disconnected = False
        try:
            while True:
                if await request.is_disconnected():
                    disconnected = True
                    break
                try:
                    item = await asyncio.wait_for(q.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                if item is None:
                    break
                yield item
        finally:
            cancel.set()
            await asyncio.to_thread(worker.join, 2.0)

        # ALWAYS write cache on a clean final (read gated by no_cache; write is
        # not). Skipped on disconnect, and on error (where manifest stays None).
        final = holder["manifest"]
        sig = holder["sig"]
        path = holder["path"]
        if (
            final is not None
            and not disconnected
            and sig is not None
            and path is not None
        ):
            await asyncio.to_thread(cache_save_manifest, path.resolve(), sig, final)

    return EventSourceResponse(gen())
