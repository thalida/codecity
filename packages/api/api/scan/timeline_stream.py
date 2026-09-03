"""The timeline stream: one history read, as the events a reader consumes.

Beside the scanner for the same reason the manifest stream is: this is the
READ's shape — fetch, walk, blobs, assemble — not the wire's. The route parses
the query and hands these events to EventSourceResponse; what to say is here.
"""

import asyncio
import logging
import threading
from typing import Any, AsyncIterator

from fastapi import Request

from api.cache import cache_load_timeline, cache_save_timeline
from api.core.constants import TimelineEvent, TimelineStage
from api.git import CloneProgress, ResolveError, SourceKind, SourceRef, classify
from api.git import resolve_ref
from api.git import fetch_lfs_history, hydrate_blobs, resolve_source
from api.routers import sse
from api.routers.sse import Put, stream
from api.scan import (
    ASSEMBLE_STEPS,
    NotAGitRepoError,
    ScanCancelledError,
    assemble_tick,
    build_timeline_bundle,
)
from api.utils.labels import label_from_source


logger = logging.getLogger(__name__)


def timeline_events(
    request: Request,
    src: str,
    branch: str | None,
    use_cache: bool,
    excludes: frozenset[str],
) -> AsyncIterator[dict[str, Any]]:
    """Every event one history read of `src` produces, in order.

    Not `async def`: the read runs on a worker and `stream` hands back the
    iterator over what it puts. An async function that returns rather than
    yields is a coroutine, and a coroutine is not something to iterate.
    """
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
                SourceRef(src, branch),
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

    return stream(request, work, on_complete=save)
