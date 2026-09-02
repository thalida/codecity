"""The manifest stream: one scan, as the events a reader consumes.

Beside the scanner rather than in the route because it is the SCAN's shape, not
the wire's — what a caller must know to follow one, in order. Failures here are
error EVENTS: the stream is open by the time they happen, and a 4xx after the
first byte is not a thing.

The route's job is the wire around it: parse the query, hand these events to
EventSourceResponse. This is what to say, not how to say it.
"""

import asyncio
import logging
import threading
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import Request

from api.core.constants import ErrorCode, ScanEvent
from api.routers import sse
from api.routers.sse import Put, stream
from api.utils.labels import label_from_source
from api.cache import (
    cache_clear_timeline,
    cache_load_manifest,
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
    SourceRef,
    classify,
    ensure_clone,
    resolve_local,
    resolve_ref,
)
from api.scan import ScanCancelledError, reconstruct_manifest, scan_tree, signature_tree


logger = logging.getLogger(__name__)


async def manifest_events(
    request: Request,
    src: str,
    branch: str | None,
    use_cache: bool,
    excludes: frozenset[str],
    ref: str | None,
) -> AsyncIterator[dict[str, Any]]:
    """Every event one scan of `src` produces, in the order a reader gets them."""
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
    # Stamped onto every manifest this stream emits: a read sends it back to
    # name the same root, so it has to be the branch AS PASSED.
    source = SourceRef(src, branch)
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
                m = reconstruct_manifest(str(path), source, sha, use_cache=use_cache)
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
                    _put(sse.event(ScanEvent.MANIFEST_COMPLETE, {"manifest": cached}))
                    return

            # Cold scan: partial + complete manifests, with heartbeat progress.
            for ev in scan_tree(
                str(path),
                source,
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
