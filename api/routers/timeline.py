"""GET /api/timeline — the commit-scrub bundle, as an SSE stream.

One route, because building the bundle is a different job from scanning a tree:
it walks every commit, resolves every blob those commits touched, and assembles
a union manifest the client replays against. The work itself is api/scan's; this
is the streaming wrapper over it.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from fastapi import APIRouter, Query, Request
from sse_starlette.sse import EventSourceResponse

from api.cache import cache_load_timeline, cache_save_timeline
from api.core.constants import TimelineEvent, TimelineStage
from api.git import CloneProgress, ResolveError, SourceKind, classify, resolve_ref
from api.git import fetch_lfs_history, hydrate_blobs, resolve_source
from api.models.events import TimelineStreamMessage
from api.routers import sse
from api.routers.sse import Put, stream
from api.scan import (
    ASSEMBLE_STEPS,
    NotAGitRepoError,
    ScanCancelledError,
    assemble_tick,
    build_timeline_bundle,
    normalize_excludes,
)
from api.utils.labels import label_from_source

router = APIRouter(prefix="/api", tags=["timeline"])

logger = logging.getLogger("codecity.timeline")


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
            "model": TimelineStreamMessage,
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
    excludes = normalize_excludes(exclude)
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
            _put(sse.event(TimelineEvent.PROGRESS, data))

        def _on_hydrate(p: CloneProgress) -> None:
            # git fetch → the "downloading history" tick, counts and all.
            _put(
                sse.event(
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
                _put(sse.error(e.message, e.code))
                return
            built["path"] = target
            head = resolve_ref(target, "HEAD")
            built["head"] = head
            if use_cache and head is not None:
                cached = cache_load_timeline(target.resolve(), head, excludes)
                if cached is not None:
                    _put(sse.event(TimelineEvent.COMPLETE, {"bundle": cached}))
                    return
            # Backfill a blobless clone before the walk, or blob resolution
            # hangs on per-blob fetches. Never touches a local repo.
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
            _put(sse.event(TimelineEvent.COMPLETE, {"bundle": bundle}))
        except ScanCancelledError:
            pass  # client disconnected mid-hydrate; nothing to report
        except NotAGitRepoError as e:
            _put(sse.error(str(e)))
        except Exception as e:  # noqa: BLE001
            logger.exception("timeline build failed for src=%s", src)
            _put(sse.error(f"timeline failed: {e}"))
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
