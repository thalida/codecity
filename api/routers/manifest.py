"""The manifest routes: GET /api/manifest (SSE stream), GET
/api/manifest/signature, GET /api/timeline (SSE stream).

Source classification/resolution lives in api.git.source; these are the
thin HTTP handlers over it. A ResolveError carries a status + message, plus a
code where the UI answers the failure differently: the signature route turns it
into an HTTPException, while the manifest and timeline SSE routes turn it into
an `error` event (EventSource can't read 4xx bodies)."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from pathlib import Path
from typing import Any, AsyncIterator, Union

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from api.core.constants import ErrorCode, ScanEvent, TimelineEvent, TimelineStage
from api.routers.sse import Put, stream
from api.utils.labels import label_from_source
from api.models.events import (
    CloneProgressEvent,
    CompleteManifestEvent,
    ErrorEvent,
    PartialManifestEvent,
    ScanProgressEvent,
    TimelineCompleteEvent,
    TimelineProgressEvent,
)
from api.models.manifest import Manifest, SignatureResponse
from api.core.security import TRUST
from api.cache import (
    cache_clear_timeline,
    cache_load_manifest,
    cache_load_newest_manifest,
    cache_load_ref_manifest,
    cache_load_timeline,
    cache_save_manifest,
    cache_save_ref_manifest,
    cache_save_timeline,
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
    fetch_lfs_history,
    hydrate_blobs,
    resolve_local,
    resolve_ref,
    resolve_source,
)
from api.scan import (
    ASSEMBLE_STEPS,
    NotAGitRepoError,
    ScanCancelledError,
    assemble_tick,
    build_timeline_bundle,
    reconstruct_manifest,
    scan_tree,
    signature_tree,
)

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
        # The clone dir is keyed on the branch AS PASSED, so a repo first opened
        # without one (server-resolved default) lives somewhere else than the
        # branch the client later recorded for it. Both are the same repo here.
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
    exclude: list[str] = Query(default_factory=list),
) -> EventSourceResponse:
    use_cache = not no_cache
    excludes = _norm_excludes(exclude)
    pending_label = label_from_source(src)

    is_remote = classify(src) is SourceKind.REMOTE

    built: dict[str, Any] = {"bundle": None, "path": None, "head": None}

    def work(_put: Put, cancel: threading.Event) -> None:
        def _on_progress(payload: dict[str, Any]) -> None:
            stage = payload["stage"]
            data: dict[str, Any] = {"stage": stage, "label": pending_label}
            if stage == TimelineStage.HISTORY:
                data["commits"] = payload.get("commits")
            elif stage == TimelineStage.BLOBS:
                data["blobsDone"] = payload.get("done")
                data["blobsTotal"] = payload.get("total")
            elif stage == TimelineStage.ASSEMBLE:
                data["percent"] = payload.get("percent")
            _put(_sse(TimelineEvent.PROGRESS, data))

        def _on_hydrate(p: CloneProgress) -> None:
            # git fetch → the "downloading history" tick, counts and all.
            _put(
                _sse(
                    TimelineEvent.PROGRESS,
                    {
                        "stage": TimelineStage.FETCH,
                        "percent": p.percent,
                        "objects": p.objects,
                        "objectsTotal": p.objects_total,
                        "mib": p.mib,
                        "label": pending_label,
                    },
                )
            )

        try:
            try:
                target = resolve_source(src, branch)
            except ResolveError as e:
                _put(_sse_error(e.message, e.code))
                return
            built["path"] = target
            head = resolve_ref(target, "HEAD")
            built["head"] = head
            if use_cache and head is not None:
                cached = cache_load_timeline(target.resolve(), head, excludes)
                if cached is not None:
                    _put(_sse(TimelineEvent.COMPLETE, {"bundle": cached}))
                    return
            # A blobless remote clone has no historical blob content — backfill it
            # before the walk so blob resolution reads local objects rather than
            # hanging on a per-blob promisor fetch. Never touches a local repo.
            if is_remote:
                hydrate_blobs(target, on_progress=_on_hydrate, cancel_event=cancel)
                # All-history, so blob resolution reads real content at every
                # commit rather than only at HEAD.
                fetch_lfs_history(target, cancel_event=cancel)
            bundle = build_timeline_bundle(
                str(target),
                use_cache=use_cache,
                extra_exclude_paths=excludes,
                on_progress=_on_progress,
            )
            built["bundle"] = bundle
            # Serialising a big bundle is its own wait and the client is blind to
            # it: the row would otherwise sit on the last computed step throughout.
            assemble_tick(_on_progress, ASSEMBLE_STEPS)
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

    async def save() -> None:
        """Write-through on a clean finish; the read is gated by no_cache, the
        write never is. Nothing to save when the build errored."""
        bundle, path, head = built["bundle"], built["path"], built["head"]
        if bundle is not None and path is not None and head is not None:
            await asyncio.to_thread(
                cache_save_timeline, path.resolve(), head, bundle, excludes
            )

    return EventSourceResponse(stream(request, work, on_complete=save))


def _as_json(obj: object) -> Any:
    """json.dumps hook: the manifest and timeline payloads are Pydantic models,
    everything else in an event payload is already a JSON primitive."""
    if isinstance(obj, BaseModel):
        return obj.model_dump()
    raise TypeError(f"not JSON-serialisable: {type(obj).__name__}")


def _sse(event: "ScanEvent | TimelineEvent", payload: dict[str, Any]) -> dict[str, Any]:
    """sse-starlette event dict: {'event': name, 'data': json-string}. Both
    StrEnums serialize to their wire string ('manifest-complete', 'timeline-
    progress', …).

    None values are dropped, so every event matches what its model documents:
    absent-or-value, never null. A progress line that carries no object count
    would otherwise ship `"objects": null` for the client to special-case."""
    return {
        "event": event,
        "data": json.dumps(
            {k: v for k, v in payload.items() if v is not None}, default=_as_json
        ),
    }


def _sse_error(message: str, code: ErrorCode | None = None) -> dict[str, Any]:
    """An `error` SSE event, single-sourced through the ErrorEvent model.
    `exclude_none` keeps an uncoded error absent-or-value on the wire rather
    than shipping a null the client would have to special-case."""
    return _sse(
        ScanEvent.ERROR,
        ErrorEvent(error=message, code=code).model_dump(exclude_none=True),
    )


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
                yield _sse_error(e.message, e.code)
                return

        built: dict[str, Any] = {"manifest": None, "sig": None, "path": None}

        def work(_put: Put, cancel: threading.Event) -> None:
            def _on_clone(p: CloneProgress) -> None:
                _put(
                    _sse(
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

            try:
                # Clone phase (git only): emit `clone-progress` FIRST, then clone
                # with live progress + cancel support.
                if kind is SourceKind.REMOTE:
                    _put(_sse(ScanEvent.CLONE_PROGRESS, {"label": pending_label}))
                    try:
                        path = ensure_clone(
                            src,
                            branch,
                            on_progress=_on_clone,
                            on_heartbeat=_on_clone_heartbeat,
                            cancel_event=cancel,
                        )
                    except RepoNotFoundError as e:
                        _put(_sse_error(str(e), ErrorCode.REPO_NOT_FOUND))
                        return
                    except (BranchNotFoundError, HostUnreachableError) as e:
                        _put(_sse_error(str(e)))
                        return
                    except CloneError as e:
                        _put(_sse_error(str(e)))
                        return
                else:
                    assert local_path is not None
                    path = local_path

                built["path"] = path
                TRUST.register(path)

                # A no_cache scan means "rebuild everything for this source" —
                # evict the per-HEAD timeline bundle too, so re-entering Timeline
                # mode rebuilds fresh rather than serving a stale/older-code one.
                if not use_cache:
                    cache_clear_timeline(path.resolve())

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

                # Warm-cache short-circuit. The signature costs a full stat-walk
                # of the tree, and scan_tree computes the same value as it walks
                # — so only pay for it up front when there's a cache to look up,
                # and take the scan's own below otherwise.
                if use_cache:
                    sig = signature_tree(
                        str(path), use_cache=use_cache, extra_exclude_paths=excludes
                    ).content_signature
                    built["sig"] = sig
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
                    if ev.phase is ScanEvent.MANIFEST_COMPLETE:
                        built["manifest"] = ev.manifest
                        built["sig"] = ev.manifest.content_signature
                    _put(_sse(ev.phase, {"manifest": ev.manifest}))
            except ScanCancelledError:
                pass  # client disconnected mid-clone/scan; nothing to report
            except Exception as e:  # noqa: BLE001
                logger.exception("manifest scan failed for src=%s", src)
                _put(_sse_error(f"scan failed: {e}"))
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
