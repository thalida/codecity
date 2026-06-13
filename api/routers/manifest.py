"""The manifest routes: GET /api/manifest (SSE stream), GET
/api/manifest/signature, DELETE /api/manifest/cache.

Source classification/resolution lives in api.services.source; these are the
thin HTTP handlers over it. A ResolveError carries a status + message: the
signature/cache routes turn it into an HTTPException, while the SSE route turns
it into an `error` event (EventSource can't read 4xx bodies)."""

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
    ScanProgressEvent,
)
from api.models.manifest import SignatureResponse
from api.models.responses import CacheClearResponse
from api.security import TRUST
from api.services.cache import (
    cache_clear_all,
    cache_load_manifest,
    cache_save_manifest,
)
from api.services.clone import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    clone_dir_for,
    ensure_clone,
    remove_clone,
)
from api.services.scan import ScanCancelledError, scan_tree, signature_tree
from api.services.source import (
    ResolveError,
    SourceKind,
    classify,
    display_name_for_manifest,
    resolve_local,
    resolve_source,
)

router = APIRouter(prefix="/api", tags=["manifest"])


def _apply_display_name(m: dict[str, Any]) -> None:
    """Overlay the friendly repo name onto the manifest's root tree.name at serve
    time (like display_root below), so every consumer reads one authoritative
    label rather than the cache-dir basename a cloned root carries."""
    tree = m.get("tree")
    if tree:
        label = display_name_for_manifest(m)
        if label:
            tree["name"] = label


logger = logging.getLogger("codecity.manifest")


@router.get("/manifest/signature", response_model=SignatureResponse)
def signature(
    src: str = Query(...),
    branch: str | None = Query(None),
    no_cache: bool = Query(False),
) -> SignatureResponse:
    try:
        target = resolve_source(src, branch)
    except ResolveError as e:
        raise HTTPException(e.status, e.message)
    try:
        sig = signature_tree(str(target), use_cache=not no_cache)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"signature failed: {e}")
    return SignatureResponse.model_validate(dict(sig))


@router.delete("/manifest/cache", response_model=CacheClearResponse)
def clear_cache(
    src: str = Query(...),
    branch: str | None = Query(None),
) -> CacheClearResponse:
    if not src:
        raise HTTPException(400, "missing 'src' query param")
    kind = classify(src)
    if kind is SourceKind.INVALID:
        raise HTTPException(400, "unrecognized source — pass a local path or a git URL")
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


def _sse(event: str, payload: dict[str, Any]) -> dict[str, Any]:
    """sse-starlette event dict: {'event': name, 'data': json-string}."""
    return {"event": event, "data": json.dumps(payload)}


def _sse_error(message: str) -> dict[str, Any]:
    """An `error` SSE event, single-sourced through the ErrorEvent model."""
    return _sse("error", ErrorEvent(error=message).model_dump())


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
                "`manifest-complete`/`error`."
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
) -> EventSourceResponse:
    use_cache = not no_cache

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
            yield _sse_error("unrecognized source — pass a local path or a git URL")
            return
        local_path: Path | None = None
        if kind is SourceKind.REMOTE:
            display = f"{src}@{branch}" if branch else src
        else:
            try:
                local_path = await asyncio.to_thread(resolve_local, src)
            except ResolveError as e:
                yield _sse_error(e.message)
                return
            display = src

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
                    "clone-progress",
                    {
                        "display_root": display,
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
                    "clone-progress",
                    {"display_root": display, "mb_on_disk": mb_on_disk},
                )
            )

        def _on_scan(files_scanned: int) -> None:
            _put(
                _sse(
                    "scan-progress",
                    {"display_root": display, "files_scanned": files_scanned},
                )
            )

        def _run() -> None:
            try:
                # Clone phase (git only): emit `clone-progress` FIRST, then clone
                # with live progress + cancel support.
                if kind is SourceKind.REMOTE:
                    _put(_sse("clone-progress", {"display_root": display}))
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
                _put(_sse("scan-progress", {"display_root": display}))

                # Signature (cache key) + warm-cache short-circuit.
                sig = signature_tree(str(path), use_cache=use_cache)["signature"]
                holder["sig"] = sig
                if use_cache:
                    cached = cache_load_manifest(path.resolve(), sig)
                    if cached is not None:
                        if kind is SourceKind.REMOTE:
                            cached["display_root"] = display
                        _apply_display_name(cached)
                        _put(_sse("manifest-complete", {"manifest": cached}))
                        return

                # Cold scan: partial + complete manifests, with heartbeat progress.
                for ev in scan_tree(
                    str(path),
                    use_cache=use_cache,
                    cancel_event=cancel,
                    on_scan_progress=_on_scan,
                ):
                    phase = ev["phase"]  # "manifest-partial" | "manifest-complete"
                    m = ev["manifest"]
                    if kind is SourceKind.REMOTE:
                        m["display_root"] = display
                    _apply_display_name(m)
                    if phase == "manifest-complete":
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
