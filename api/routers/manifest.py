"""/api/manifest/signature, DELETE /api/manifest/cache.

Source classification + resolution shared by the signature route, cache
route, and the SSE manifest stream (added in a later task). Local sources
require CODECITY_ALLOW_LOCAL_REPOS and a git working tree; git URLs are
cloned via the service layer.

ResolveError carries a status + message; the signature/cache routes turn
it into an HTTPException. The SSE route (added later) turns it into an
`error` event instead (EventSource can't read 4xx bodies)."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Literal, Union

from fastapi import APIRouter, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from api.config import local_repos_allowed
from api.models.events import (
    CloningEvent,
    ErrorEvent,
    FinalEvent,
    ScanningEvent,
    SkeletonEvent,
)
from api.models.manifest import SignatureResponse
from api.models.responses import CacheClearResponse
from api.security import TRUST
from api.services.cache import (
    cache_clear_manifests,
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
)
from api.services.scan import ScanCancelledError, scan_tree, signature_tree

router = APIRouter(prefix="/api", tags=["manifest"])

logger = logging.getLogger("codecity.manifest")

_LOCAL_PATH_PREFIX = re.compile(r"^(/|~|\./|\.\./|[A-Za-z]:[\\/])")
_GIT_SSH_FORM = re.compile(r"^[^@]+@[^:]+:")

_NOT_GIT_ERROR = (
    "path is not inside a git working tree. CodeCity requires a git "
    "project — try `git init` inside the directory, or paste a git "
    "URL instead."
)

_LOCAL_DISABLED_ERROR = (
    "local repositories are disabled — restart codecity with "
    "CODECITY_ALLOW_LOCAL_REPOS=1. "
    "See https://github.com/thalida/codecity#local-directories"
)


@dataclass
class ResolveError(Exception):
    status: int
    message: str


@dataclass
class Resolved:
    path: Path
    src: str
    branch: str | None
    kind: Literal["local", "git"]
    display_root: str


def classify(raw: str) -> Literal["local", "git", "invalid"]:
    """Classify a raw ?src= value as a local path, a git URL, or invalid.

    Path-like prefixes (absolute, home, relative, Windows drive) → 'local'.
    URLs (scheme:// or git@host:path SSH form) → 'git'.
    Anything else → 'invalid'.
    """
    if not raw:
        return "invalid"
    if _LOCAL_PATH_PREFIX.match(raw):
        return "local"
    if "://" in raw or _GIT_SSH_FORM.match(raw):
        return "git"
    return "invalid"


def _is_git_working_tree(path: Path) -> bool:
    """Return True if path is inside a git working tree.

    Runs git rev-parse --is-inside-work-tree with cwd=path:
      - working tree (top-level OR subdir OR linked worktree) → "true"
      - bare repo → "false"
      - non-git directory → command fails with non-zero exit

    Failures (missing git binary, timeout, OS error) all fall through to
    False — better to reject with a clear message than to scan a path we
    can't verify."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(path),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0 and r.stdout.strip() == "true"


def _resolve_local(src: str) -> Path:
    """Validate a local source path (no network) and return the resolved dir.
    Raises ResolveError on any validation failure."""
    if not local_repos_allowed():
        raise ResolveError(403, _LOCAL_DISABLED_ERROR)
    try:
        target = Path(src).resolve(strict=True)
    except (OSError, RuntimeError):
        raise ResolveError(404, "path not found")
    if not target.is_dir():
        raise ResolveError(400, "path is not a directory")
    if not _is_git_working_tree(target):
        raise ResolveError(400, _NOT_GIT_ERROR)
    return target


def resolve_source(src: str, branch: str | None) -> Resolved:
    """Resolve a raw ?src into a scan target. Raises ResolveError on any
    validation failure. For git URLs this performs the clone (network).

    The SSE manifest route does NOT use this — it clones on a worker thread
    (see the route) so clone progress streams and a mid-clone disconnect can
    cancel it. This blocking form backs the signature route."""
    if not src:
        raise ResolveError(400, "missing 'src' query param")
    kind = classify(src)
    if kind == "invalid":
        raise ResolveError(400, "unrecognized source — pass a local path or a git URL")
    if kind == "git":
        display = f"{src}@{branch}" if branch else src
        try:
            with TRUST.clone_lock:
                local = ensure_clone(src, branch)
        except (BranchNotFoundError, RepoNotFoundError, HostUnreachableError) as e:
            raise ResolveError(400, str(e))
        except CloneError as e:
            raise ResolveError(502, str(e))
        return Resolved(local, src, branch, "git", display)
    # kind == "local" — ignore any branch, scan the working tree in place
    return Resolved(_resolve_local(src), src, None, "local", src)


@router.get("/manifest/signature", response_model=SignatureResponse)
def signature(
    src: str = Query(...),
    branch: str | None = Query(None),
    no_cache: bool = Query(False),
) -> SignatureResponse:
    try:
        resolved = resolve_source(src, branch)
    except ResolveError as e:
        raise HTTPException(e.status, e.message)
    try:
        sig = signature_tree(str(resolved.path), use_cache=not no_cache)
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
    if kind == "invalid":
        raise HTTPException(400, "unrecognized source — pass a local path or a git URL")
    if kind == "git":
        abs_root = clone_dir_for(src, branch)
    else:
        # Non-strict resolve so a recents entry for a since-deleted path
        # still drops its cache.
        abs_root = Path(src).resolve(strict=False)
    return CacheClearResponse(deleted=cache_clear_manifests(abs_root))


def _sse(event: str, payload: dict[str, Any]) -> dict[str, Any]:
    """sse-starlette event dict: {'event': name, 'data': json-string}."""
    return {"event": event, "data": json.dumps(payload)}


def _sse_error(message: str) -> dict[str, Any]:
    """An `error` SSE event, single-sourced through the ErrorEvent model."""
    return _sse("error", ErrorEvent(error=message).model_dump())


# Documented SSE event union: surfacing all five event models in the
# OpenAPI `responses` registers each as a schema component (richer Scalar
# docs) AND transitively pulls Manifest -> tree types via Skeleton/FinalEvent.
SSEEvent = Union[CloningEvent, ScanningEvent, SkeletonEvent, FinalEvent, ErrorEvent]


@router.get(
    "/manifest",
    responses={
        200: {
            "description": (
                "Server-Sent Events stream (`text/event-stream`). Named events and "
                "their JSON `data` payloads: `cloning` (CloningEvent), `scanning` "
                "(ScanningEvent), `skeleton` (SkeletonEvent), `final` (FinalEvent), "
                "`error` (ErrorEvent). The client closes the connection on `final`/`error`."
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
        if kind == "invalid":
            yield _sse_error("unrecognized source — pass a local path or a git URL")
            return
        local_path: Path | None = None
        if kind == "git":
            display = f"{src}@{branch}" if branch else src
        else:
            try:
                local_path = await asyncio.to_thread(_resolve_local, src)
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
            _put(_sse("cloning", {
                "display_root": display, "stage": stage, "percent": percent,
            }))

        def _on_scan(files_scanned: int) -> None:
            _put(_sse("scanning", {"display_root": display, "files_scanned": files_scanned}))

        def _run() -> None:
            try:
                # Clone phase (git only): emit `cloning` FIRST, then clone with
                # live progress + cancel support.
                if kind == "git":
                    _put(_sse("cloning", {"display_root": display}))
                    try:
                        with TRUST.clone_lock:
                            path = ensure_clone(
                                src, branch,
                                on_progress=_on_clone, cancel_event=cancel,
                            )
                    except (BranchNotFoundError, RepoNotFoundError, HostUnreachableError) as e:
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
                _put(_sse("scanning", {"display_root": display}))

                # Signature (cache key) + warm-cache short-circuit.
                sig = signature_tree(str(path), use_cache=use_cache)["signature"]
                holder["sig"] = sig
                if use_cache:
                    cached = cache_load_manifest(path.resolve(), sig)
                    if cached is not None:
                        if kind == "git":
                            cached["display_root"] = display
                        _put(_sse("final", {"manifest": cached}))
                        return

                # Cold scan: skeleton + final, with heartbeat progress.
                for ev in scan_tree(
                    str(path), use_cache=use_cache,
                    cancel_event=cancel, on_scan_progress=_on_scan,
                ):
                    phase = ev["phase"]  # "skeleton" | "final"
                    m = ev["manifest"]
                    if kind == "git":
                        m["display_root"] = display
                    if phase == "final":
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
        if final is not None and not disconnected and sig is not None and path is not None:
            await asyncio.to_thread(cache_save_manifest, path.resolve(), sig, final)

    return EventSourceResponse(gen())
