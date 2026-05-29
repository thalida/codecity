"""Local HTTP server backing the browser-served frontend.

Serves the Vite-built frontend from a static dir supplied by the Docker
entrypoint (or `static_dir=` kwarg to `start_server`) and computes a
scan manifest on demand at `/api/manifest?src=…[&branch=…]`. `src` is
either a local absolute path or a git URL; for git URLs, the repo is
cloned into `~/.cache/codecity/clones/` and scanned from there.

Bind address is configurable via `start_server(host=...)`; production
(`python -m api`) binds 0.0.0.0 so Docker port-forwarding works.
Container isolation gates external access — the published `-p 8080:8080`
is what the host actually exposes.

Threading: ``ThreadingHTTPServer`` so concurrent /api/file fetches and a
manifest scan don't serialize on each other. The server runs on a daemon
thread so the main thread can stay responsive (and let Ctrl-C land).

Trust model: every successful manifest scan registers its absolute root
in ``_State.allowed_roots``. ``/api/file`` then validates that the
requested file resolves under at least one of those roots. This means a
client can only fetch files from directories it has previously asked the
server to scan — there's no global filesystem read.
"""

from __future__ import annotations

import gzip
import json
import mimetypes
import os
import queue
import re
import select
import socket as _socket
import subprocess
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BufferedIOBase
from pathlib import Path
from typing import Any, Callable, Iterable, Literal
from urllib.parse import parse_qs, urlparse

from api.clone import (
    CloneError,
    BranchNotFoundError,
    RepoNotFoundError,
    HostUnreachableError,
    ensure_clone,
)
from api.cache import (
    cache_clear_manifests,
    cache_load_manifest,
    cache_save_manifest,
)
from api.media import is_media
from api.scan import (
    ScanCancelledError,
    scan_tree,
    signature_tree,
)
from api.types import (
    CacheClearResponse,
    CommitDetailResponse,
    ErrorResponse,
    FileTooLargeResponse,
    HealthResponse,
    Manifest,
    SignatureResponse,
)

# Cap individual /api/file responses so a stray symlink to a giant blob
# doesn't try to load 10 GB into the browser.
MAX_FILE_BYTES = 100 * 1024 * 1024


_LOCAL_PATH_PREFIX = re.compile(r"^(/|~|\./|\.\./|[A-Za-z]:[\\/])")
_GIT_SSH_FORM = re.compile(r"^[^@]+@[^:]+:")


def _classify_source(raw: str) -> Literal["local", "git", "invalid"]:
    """Classify a raw `?src=` value as a local path, a git URL, or invalid.

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
    """Return True if ``path`` is inside a git working tree.

    Runs ``git rev-parse --is-inside-work-tree`` with cwd=path:
      - working tree (top-level OR subdir OR linked worktree) → "true"
      - bare repo → "false"
      - non-git directory → command fails with non-zero exit

    CodeCity is fundamentally git-aware: every local scan needs a real
    working tree to walk. Bare repos have no working tree (just the .git
    object database) so they're rejected here too.

    Failures (missing git binary, timeout, OS error) all fall through to
    False — better to reject with a clear message than to scan a path we
    can't verify."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(path),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
            # Defensive: a path nested inside a credentialed repo could
            # otherwise prompt for a passphrase and hang the subprocess.
            # We're only reading metadata, so no auth is ever needed.
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and result.stdout.strip() == "true"


_NOT_GIT_ERROR = (
    "path is not inside a git working tree. CodeCity requires a git "
    "project — try `git init` inside the directory, or paste a git "
    "URL instead."
)


# Bodies under this threshold skip compression — gzip's framing
# overhead (~20 bytes header + trailer) exceeds the savings on small
# responses. The typical hits are /api/health and small error JSON.
_GZIP_MIN_BYTES = 256


def _maybe_gzip(
    handler: BaseHTTPRequestHandler, body: bytes,
) -> tuple[bytes, str | None]:
    """If the client advertised Accept-Encoding: gzip, gzip-encode body.

    Returns ``(encoded, "gzip")`` when compression applies, ``(body,
    None)`` otherwise. Caller is responsible for setting the
    Content-Encoding header from the second element when non-None.

    The Accept-Encoding parser is intentionally loose: a substring
    check for "gzip" matches the typical "gzip, deflate" or
    "gzip;q=1.0". It does not parse RFC 7231 q-values; ``q=0`` would
    be misinterpreted as accept, but that's a vanishingly rare config
    and the worst case is a successfully-decoded gzip response.
    """
    accept = handler.headers.get("Accept-Encoding", "")
    if "gzip" not in accept.lower() or len(body) < _GZIP_MIN_BYTES:
        return body, None
    return gzip.compress(body, compresslevel=6), "gzip"


# Where the Vite build output lives. Resolved at import time so tests can
# spin up a server without an installed wheel layout.
STATIC_DIR = Path(__file__).resolve().parent / "static"


class _State:
    """Module-level state shared by every handler instance."""
    static_dir: Path = STATIC_DIR
    # Every absolute path that has been successfully scanned this session.
    # /api/file uses this as its trust set.
    allowed_roots: set[Path] = set()
    # Guards allowed_roots — ThreadingHTTPServer can run a manifest scan
    # (writer) concurrently with a file fetch (reader), and CPython will
    # raise RuntimeError: Set changed size during iteration if a write
    # lands mid-read.
    allowed_roots_lock: threading.Lock = threading.Lock()
    # Serializes clone-or-update so two concurrent manifest requests for
    # the same URL don't race the working tree. ensure_clone is the cache
    # itself (filesystem-backed); the lock just keeps it consistent.
    clone_lock: threading.Lock = threading.Lock()


JsonBody = (
    Manifest
    | SignatureResponse
    | ErrorResponse
    | FileTooLargeResponse
    | HealthResponse
    | CacheClearResponse
    | CommitDetailResponse
)


def _send_json(handler: BaseHTTPRequestHandler, status: int, body: JsonBody) -> None:
    payload = json.dumps(body).encode("utf-8")
    payload, encoding = _maybe_gzip(handler, payload)
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    if encoding:
        handler.send_header("Content-Encoding", encoding)
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def _stream_events(
    handler: BaseHTTPRequestHandler,
    events: Iterable[dict[str, Any]],
    cancel_event: threading.Event,
) -> None:
    """Stream NDJSON events over a chunked HTTP response.

    Each event becomes one line: `<json>\\n`. Encoded via iterencode
    so peak memory is bounded by one ~64 KB chunk, not the serialized
    size of the manifest. Wraps wfile in gzip when the client
    advertises it.

    Flushes after every event boundary: ``gz.flush()`` emits a
    ``Z_SYNC_FLUSH`` DEFLATE block (so decompressors actually see the
    bytes — ``GzipFile.write()`` buffers internally and would
    otherwise emit nothing until close), then ``handler.wfile.flush()``
    pushes the BufferedWriter into the socket. Without this the
    skeleton event would be stuck behind the final event in
    production.

    Sets cancel_event on BrokenPipe/ConnectionReset (write-time AND
    close-time) so a concurrently-running scan thread can stop ASAP.
    Also checks cancel_event between events so a watchdog can
    interrupt iteration without waiting for a write to fail."""
    accept = handler.headers.get("Accept-Encoding", "")
    use_gzip = "gzip" in accept.lower()

    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", "application/x-ndjson")
    if use_gzip:
        handler.send_header("Content-Encoding", "gzip")
    # No Content-Length → chunked transfer.
    handler.end_headers()

    # Both BufferedWriter (handler.wfile) and GzipFile inherit from
    # io.BufferedIOBase, so we can reassign without a `# type: ignore`.
    sink: BufferedIOBase = handler.wfile
    gz: gzip.GzipFile | None = None
    if use_gzip:
        # mtime=0 → deterministic bytes (helps tests). compresslevel=6
        # matches the existing _maybe_gzip path's choice.
        gz = gzip.GzipFile(fileobj=sink, mode="wb", compresslevel=6, mtime=0)
        sink = gz

    try:
        encoder = json.JSONEncoder()
        for event in events:
            for chunk in encoder.iterencode(event):
                sink.write(chunk.encode("utf-8"))
            sink.write(b"\n")
            # Boundary flush: emit a Z_SYNC_FLUSH DEFLATE block so the
            # decompressor sees this event's bytes, then push from the
            # BufferedWriter into the socket.
            if gz is not None:
                gz.flush()
            handler.wfile.flush()
            # Let a watchdog interrupt between events without needing a
            # write to fail first.
            if cancel_event.is_set():
                break
    except (BrokenPipeError, ConnectionResetError):
        cancel_event.set()
        raise
    finally:
        if gz is not None:
            try:
                gz.close()
            except (BrokenPipeError, ConnectionResetError):
                # Gzip buffers most output, so a peer that already
                # disconnected often only surfaces at close time.
                # Mirror the write-path behavior: surface cancel to the
                # surrounding scan, but don't re-raise (we're in
                # finally; any real exception already propagated).
                cancel_event.set()


_WATCHDOG_POLL_SEC = 0.5


def _start_disconnect_watchdog(
    handler: BaseHTTPRequestHandler,
    cancel_event: threading.Event,
) -> threading.Thread:
    """Spawn a daemon thread that watches `handler.connection` for
    client-side EOF and sets `cancel_event` when seen.

    Polls every ~500ms via select(); when the socket becomes
    readable, peeks one byte — an empty peek means the peer closed.
    Loop also exits if cancel_event is set by anyone else (normal
    scan completion, or the writer noticing a broken pipe first).
    """
    sock = handler.connection

    def _loop() -> None:
        while not cancel_event.is_set():
            try:
                readable, _, _ = select.select(
                    [sock], [], [], _WATCHDOG_POLL_SEC,
                )
            except (OSError, ValueError):
                cancel_event.set()
                return
            if not readable:
                continue
            try:
                peek = sock.recv(1, _socket.MSG_PEEK)
            except OSError:
                cancel_event.set()
                return
            if not peek:
                # EOF — client closed its end.
                cancel_event.set()
                return
            # Unexpected data from the client mid-scan (the browser
            # isn't supposed to send anything until it reads the
            # response). MSG_PEEK didn't consume the byte, so select()
            # will keep waking us up on it forever — sleep one poll
            # cycle to avoid spinning at 100% CPU. cancel_event.wait()
            # both serves as the sleep AND lets the loop exit promptly
            # if anyone sets the event during the wait.
            cancel_event.wait(_WATCHDOG_POLL_SEC)

    t = threading.Thread(target=_loop, daemon=True, name="cc-disconnect-watchdog")
    t.start()
    return t


def _parse_no_cache(query: str) -> bool:
    """Parse ?no_cache=… as a boolean. Strict: only 'true' (any case)
    and '1' count as on; absent or anything else is off. Maps to
    scan_tree(use_cache=not <this>)."""
    raw = parse_qs(query).get("no_cache", [""])[0].strip().lower()
    return raw in ("true", "1")


def _parse_git_window(query: str) -> str | None:
    """Parse ?git_window=… as a `git log --since=…` expression.

    Returns ``None`` (meaning "use server default / env var") when the
    param is absent or empty. The string is forwarded verbatim to git;
    git itself rejects malformed expressions, in which case the scan
    surfaces a clean error via the existing manifest-stream error path.
    Length-capped at 64 chars to keep an invalid input from blowing up
    the subprocess argv."""
    raw = parse_qs(query).get("git_window", [""])[0].strip()
    if not raw:
        return None
    return raw[:64]


def _resolve_scan_target(
    handler: BaseHTTPRequestHandler, query: str
) -> tuple[Path, str, str | None, Literal["local", "git"]] | None:
    """Parse ?src=… [&branch=…] and resolve to a scan root.

    Returns (resolved_path, original_src, branch_or_None, kind) on success, or
    None after sending the appropriate 4xx/5xx error response.

    Branch semantics:
      - Local src: branch is silently ignored. Scan the live working tree.
      - Git URL src: branch is passed through to ensure_clone.
    """
    params = parse_qs(query)
    raw_src = params.get("src", [""])[0]
    raw_branch = params.get("branch", [""])[0] or None

    if not raw_src:
        _send_json(handler, HTTPStatus.BAD_REQUEST, {"error": "missing 'src' query param"})
        return None

    kind = _classify_source(raw_src)
    if kind == "invalid":
        _send_json(
            handler,
            HTTPStatus.BAD_REQUEST,
            {"error": "unrecognized source — pass a local path or a git URL"},
        )
        return None

    if kind == "git":
        try:
            with _State.clone_lock:
                local = ensure_clone(raw_src, raw_branch)
            return local, raw_src, raw_branch, "git"
        except (BranchNotFoundError, RepoNotFoundError, HostUnreachableError) as e:
            _send_json(handler, HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return None
        except CloneError as e:
            _send_json(handler, HTTPStatus.BAD_GATEWAY, {"error": str(e)})
            return None

    # kind == "local" — ignore any &branch=, scan the working tree in place
    try:
        scan_target = Path(raw_src).resolve(strict=True)
    except (OSError, RuntimeError):
        _send_json(handler, HTTPStatus.NOT_FOUND, {"error": "path not found"})
        return None
    if not scan_target.is_dir():
        _send_json(
            handler, HTTPStatus.BAD_REQUEST, {"error": "path is not a directory"}
        )
        return None
    if not _is_git_working_tree(scan_target):
        _send_json(
            handler, HTTPStatus.BAD_REQUEST, {"error": _NOT_GIT_ERROR}
        )
        return None
    return scan_target, raw_src, None, "local"


_COMMIT_SHA_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")


def _serve_commit_detail(handler: BaseHTTPRequestHandler, query: str) -> None:
    """GET /api/commit?sha=<sha>. Returns {sha, author, date, subject, body}
    for a commit inside any registered scan root. Validates the sha shape
    locally before shelling out to ``git show``.

    Multi-root resolution: tries each allowed scan root in turn and
    returns the first hit. Most deployments have one root; for the rare
    multi-root case this picks the first repo that contains the sha.

    No email in the response. ``git show`` is the only git call here — no
    diff is fetched.
    """
    params = parse_qs(query)
    sha = (params.get("sha") or [""])[0].strip()
    if not _COMMIT_SHA_RE.match(sha):
        _send_json(handler, HTTPStatus.BAD_REQUEST,
                   {"error": "invalid or missing sha"})
        return

    with _State.allowed_roots_lock:
        roots_snapshot = set(_State.allowed_roots)

    if not roots_snapshot:
        _send_json(handler, HTTPStatus.NOT_FOUND,
                   {"error": "no scan root registered yet — fetch /api/manifest first"})
        return

    fmt = "%H%x00%an%x00%aI%x00%s%x00%b"
    for root in roots_snapshot:
        try:
            out = subprocess.check_output(
                ["git", "-c", "safe.directory=*", "-C", str(root),
                 "show", "-s", f"--format={fmt}", sha],
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except subprocess.CalledProcessError:
            continue
        parts = out.rstrip("\n").split("\x00", 4)
        if len(parts) < 5:
            continue
        full_sha, author, iso_date, subject, body = parts
        response: CommitDetailResponse = {
            "sha": full_sha,
            "author": author,
            "date": iso_date[:10],
            "subject": subject,
            "body": body,
        }
        _send_json(handler, HTTPStatus.OK, response)
        return

    _send_json(handler, HTTPStatus.NOT_FOUND,
               {"error": "sha not found in any registered scan root"})


def _serve_manifest(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Stream the scan manifest for the requested source as NDJSON.

    Event sequence for git sources:
      cloning → scanning → skeleton → final     (cold cache, cold clone)
      cloning → scanning → final                (warm manifest cache)
    Local sources:
      scanning → skeleton → final               (cold cache)
      scanning → final                          (warm manifest cache)

    The ``cloning`` / ``scanning`` events are lightweight phase markers
    (no manifest payload) so the loading-overlay can advance its step
    indicator from real server state instead of a wall-clock timer.

    On client disconnect, the watchdog sets the cancel event within
    ~500ms; the scan exits via ScanCancelledError and no cache write
    happens.

    Pre-stream validation (missing/invalid src, missing local path)
    still returns 4xx because no response has started yet. Errors that
    arise after the first event is emitted (clone failure, scan failure)
    are surfaced as ``{phase: "error"}`` NDJSON events — the HTTP status
    is already 200 by then."""
    # Pre-stream validation: param parsing + classify + local-path stat.
    # Anything caught here still gets a clean 4xx response.
    #
    # NOTE: this re-validates the same things as _resolve_scan_target (used
    # by /api/manifest/signature). Duplicated deliberately — _serve_manifest
    # must emit a chunked NDJSON stream with phase events (`cloning`,
    # `scanning`), but _resolve_scan_target calls ensure_clone synchronously
    # which would block before any stream byte reaches the client. If you
    # change the validation rules, update BOTH places.
    params = parse_qs(query)
    raw_src = params.get("src", [""])[0]
    raw_branch = params.get("branch", [""])[0] or None

    if not raw_src:
        _send_json(handler, HTTPStatus.BAD_REQUEST, {"error": "missing 'src' query param"})
        return

    kind = _classify_source(raw_src)
    if kind == "invalid":
        _send_json(
            handler,
            HTTPStatus.BAD_REQUEST,
            {"error": "unrecognized source — pass a local path or a git URL"},
        )
        return

    local_target: Path | None = None
    if kind == "local":
        try:
            local_target = Path(raw_src).resolve(strict=True)
        except (OSError, RuntimeError):
            _send_json(handler, HTTPStatus.NOT_FOUND, {"error": "path not found"})
            return
        if not local_target.is_dir():
            _send_json(
                handler, HTTPStatus.BAD_REQUEST, {"error": "path is not a directory"}
            )
            return
        if not _is_git_working_tree(local_target):
            _send_json(
                handler, HTTPStatus.BAD_REQUEST, {"error": _NOT_GIT_ERROR}
            )
            return

    use_cache = not _parse_no_cache(query)
    git_window = _parse_git_window(query)

    cancel_event = threading.Event()
    watchdog = _start_disconnect_watchdog(handler, cancel_event)

    def _stamp_display_root(m: "Manifest") -> "Manifest":
        if kind == "git":
            m["display_root"] = display_root
        return m

    # Captured by the closure below so we can decide whether to write
    # the manifest cache after _stream_events returns.
    state: dict[str, Any] = {"final_manifest": None, "scan_target": None, "sig": None}

    # Display label for the in-flight scan. Hoisted above the first
    # yield so the cloning/scanning event can carry it — the client
    # uses this to set "{label} (pending)" before any manifest exists.
    if kind == "git":
        display_root = f"{raw_src}@{raw_branch}" if raw_branch else raw_src
    else:
        display_root = raw_src

    def _events() -> Iterable[dict[str, Any]]:
        # Git sources: emit cloning, run ensure_clone, then continue.
        # Errors during the clone become NDJSON error events because the
        # response has already begun streaming by the time this runs.
        if kind == "git":
            yield {"phase": "cloning", "display_root": display_root}
            # ensure_clone is synchronous, but we want its progress
            # callbacks to stream out as additional `cloning` events.
            # Run it on a worker thread that pushes events into a queue;
            # the generator drains the queue until a sentinel arrives,
            # then collects the result (or re-raises any exception).
            clone_q: queue.Queue[dict[str, Any] | None] = queue.Queue()
            clone_result: dict[str, Any] = {"target": None, "error": None}

            def _on_clone_progress(payload: tuple[str, int]) -> None:
                stage, percent = payload
                clone_q.put({
                    "phase": "cloning",
                    "display_root": display_root,
                    "stage": stage,
                    "percent": percent,
                })

            def _run_clone() -> None:
                try:
                    with _State.clone_lock:
                        clone_result["target"] = ensure_clone(
                            raw_src, raw_branch, on_progress=_on_clone_progress
                        )
                except Exception as e:  # pylint: disable=broad-except
                    clone_result["error"] = e
                finally:
                    clone_q.put(None)  # sentinel

            clone_thread = threading.Thread(target=_run_clone, daemon=True)
            clone_thread.start()
            while True:
                ev = clone_q.get()
                if ev is None:
                    break
                yield ev
            clone_thread.join()

            err = clone_result["error"]
            if isinstance(err, (BranchNotFoundError, RepoNotFoundError, HostUnreachableError)):
                yield {"phase": "error", "error": str(err)}
                return
            if isinstance(err, CloneError):
                yield {"phase": "error", "error": str(err)}
                return
            if err is not None:
                # Unexpected exception type — surface as an error event so
                # the client sees a clean message instead of a truncated
                # stream, and re-raise so the outer try/except logs it.
                yield {"phase": "error", "error": str(err)}
                return
            scan_target = clone_result["target"]
        else:
            assert local_target is not None
            scan_target = local_target

        state["scan_target"] = scan_target
        # Register trust root before any file-bearing event reaches the
        # client. From this point on /api/file can serve content under
        # scan_target.
        with _State.allowed_roots_lock:
            _State.allowed_roots.add(scan_target.resolve())

        # For git sources this is the second event (after `cloning`);
        # for local sources it's the first. Either way, display_root
        # rides along so the client can show the pending label
        # immediately for local sources too.
        yield {"phase": "scanning", "display_root": display_root}

        # Cheap signature probe — same call the live-poll endpoint uses.
        # git_window MUST flow in here too: it feeds the signature, and
        # without it a window change would collide with a previously
        # cached manifest under a different window.
        try:
            sig_response = signature_tree(
                str(scan_target),
                use_cache=use_cache,
                git_window=git_window,
            )
        except Exception as e:  # pylint: disable=broad-except
            yield {"phase": "error", "error": f"scan failed: {e}"}
            return
        sig = sig_response["signature"]
        state["sig"] = sig

        # Cache lookup.
        cached: Manifest | None = None
        if use_cache:
            cached = cache_load_manifest(scan_target.resolve(), sig)
            if cached is not None:
                cached = _stamp_display_root(cached)

        if cached is not None:
            yield {"phase": "final", "manifest": cached}
            return

        # Cache miss — stream live scan. scan_tree is synchronous and
        # also yields its own events (skeleton + final); we want the
        # heartbeat-driven scanning progress events to interleave with
        # those. Same queue/thread pattern as the cloning phase: the
        # worker pushes both kinds of events into one queue, the
        # generator drains and yields in arrival order.
        scan_q: queue.Queue[dict[str, Any] | None] = queue.Queue()
        scan_error: list[BaseException] = []

        def _on_scan_progress(files_scanned: int) -> None:
            scan_q.put({
                "phase": "scanning",
                "display_root": display_root,
                "files_scanned": files_scanned,
            })

        def _run_scan() -> None:
            try:
                for ev in scan_tree(
                    str(scan_target),
                    use_cache=use_cache,
                    cancel_event=cancel_event,
                    git_window=git_window,
                    on_scan_progress=_on_scan_progress,
                ):
                    scan_q.put(ev)  # skeleton + final flow through the same queue
            except BaseException as e:  # pylint: disable=broad-except
                scan_error.append(e)
            finally:
                scan_q.put(None)  # sentinel

        scan_thread = threading.Thread(target=_run_scan, daemon=True)
        scan_thread.start()
        try:
            while True:
                ev = scan_q.get()
                if ev is None:
                    break
                if ev.get("phase") in ("skeleton", "final"):
                    m = _stamp_display_root(ev["manifest"])
                    if ev["phase"] == "final":
                        state["final_manifest"] = m
                yield ev  # type: ignore[misc]
        finally:
            scan_thread.join()

        if scan_error:
            err = scan_error[0]
            if isinstance(err, ScanCancelledError):
                # Cancellation isn't an error to surface to the client —
                # they disconnected, so there's nobody to read a message.
                # Re-raise so the outer try skips the cache write and logs
                # the disconnect.
                raise err
            # Unexpected mid-stream failure (e.g., disk read error
            # during _populate_file_metadata). Emit one final error
            # event so the client sees a clear message instead of a
            # truncated stream / parse error.
            yield {"phase": "error", "error": f"scan failed: {err}"}

    try:
        _stream_events(handler, _events(), cancel_event)

        # Only cache on successful completion AND only when use_cache.
        final_manifest = state["final_manifest"]
        scan_target = state["scan_target"]
        sig = state["sig"]
        if (
            use_cache
            and final_manifest is not None
            and scan_target is not None
            and sig is not None
        ):
            cache_save_manifest(scan_target.resolve(), sig, final_manifest)

    except ScanCancelledError:
        _log_quiet("[scan] cancelled (client disconnected)")
    except (BrokenPipeError, ConnectionResetError):
        # Writer noticed the disconnect first. handle_error from
        # fix #1 swallows the propagated exception at the socketserver
        # layer; we just need to skip the cache write.
        _log_quiet("[scan] client disconnected mid-stream")
        raise
    finally:
        cancel_event.set()
        watchdog.join(timeout=1.0)


def _delete_manifest_cache(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Clear every cached manifest for the given source.

    Used by the frontend when the user removes an entry from the recents
    list — they're done with this source, so its disk cache should go
    too. Resolves git URLs to their clone-dir without actually cloning;
    resolves local paths non-strictly so cleanup still works for paths
    that no longer exist on disk."""
    params = parse_qs(query)
    raw_src = params.get("src", [""])[0]
    raw_branch = params.get("branch", [""])[0] or None

    if not raw_src:
        _send_json(handler, HTTPStatus.BAD_REQUEST, {"error": "missing 'src' query param"})
        return

    kind = _classify_source(raw_src)
    if kind == "invalid":
        _send_json(
            handler,
            HTTPStatus.BAD_REQUEST,
            {"error": "unrecognized source — pass a local path or a git URL"},
        )
        return

    if kind == "git":
        # Pure path derivation — no clone, no network.
        from api.clone import clone_dir_for
        abs_root = clone_dir_for(raw_src, raw_branch)
    else:
        # Local source: non-strict resolve so a recents entry for a
        # since-deleted path still drops its cache.
        abs_root = Path(raw_src).resolve(strict=False)

    deleted = cache_clear_manifests(abs_root)
    _send_json(handler, HTTPStatus.OK, {"deleted": deleted})


def _log_quiet(msg: str) -> None:
    """Same env-gated logger as scan._log, duplicated here so server
    doesn't import a private from scan. CODECITY_QUIET=1 silences."""
    if os.environ.get("CODECITY_QUIET") != "1":
        print(msg, file=sys.stderr, flush=True)


def _serve_manifest_signature(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Cheap variant of /api/manifest — returns just {root, scanned_at, signature}.

    Used by the frontend's live-update poll: hitting this every few
    seconds avoids paying for per-file content reads and per-file git
    history walks on every tick. The client only fetches the full
    manifest when the signature changes.
    """
    resolved = _resolve_scan_target(handler, query)
    if resolved is None:
        return
    scan_target, _raw_src, _raw_branch, _kind = resolved
    use_cache = not _parse_no_cache(query)
    # Pass git_window through so the live-update poll's signature matches
    # the cached manifest's (which is now window-keyed).
    git_window = _parse_git_window(query)

    try:
        sig = signature_tree(
            str(scan_target),
            use_cache=use_cache,
            git_window=git_window,
        )
    except Exception as e:  # pylint: disable=broad-except
        _send_json(
            handler,
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"error": f"signature failed: {e}"},
        )
        return

    _send_json(handler, HTTPStatus.OK, sig)


def _serve_file_api(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Serve a file from the user's filesystem, restricted to paths inside
    any directory that has been successfully scanned this session.
    Path-traversal and symlink-escape attempts are caught by
    ``Path.resolve()`` + ``relative_to()``."""
    params = parse_qs(query)
    raw = params.get("path", [""])[0]
    if not raw:
        _send_json(handler, HTTPStatus.BAD_REQUEST, {"error": "missing 'path' param"})
        return

    # Snapshot under the lock so a concurrent scan can't mutate the set
    # mid-iteration. Set copy is O(roots) — typically a handful.
    with _State.allowed_roots_lock:
        roots_snapshot = set(_State.allowed_roots)

    if not roots_snapshot:
        _send_json(
            handler,
            HTTPStatus.FORBIDDEN,
            {"error": "no scan root registered yet — fetch /api/manifest first"},
        )
        return

    try:
        target = Path(raw).resolve(strict=True)
    except (OSError, RuntimeError):
        _send_json(handler, HTTPStatus.NOT_FOUND, {"error": "not found"})
        return

    # Allow if the target is under ANY registered root.
    inside = False
    for root in roots_snapshot:
        try:
            target.relative_to(root)
        except ValueError:
            continue
        inside = True
        break
    if not inside:
        _send_json(handler, HTTPStatus.FORBIDDEN, {"error": "outside scan root"})
        return

    if not target.is_file():
        _send_json(handler, HTTPStatus.NOT_FOUND, {"error": "not a file"})
        return

    size = target.stat().st_size
    if size > MAX_FILE_BYTES:
        _send_json(
            handler,
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            {"error": "file too large", "size": size, "limit": MAX_FILE_BYTES},
        )
        return

    guessed, _ = mimetypes.guess_type(str(target))
    # Media types (image/video/audio/pdf) keep their guessed MIME so the
    # browser can hand them to <img>/<video>/<embed> directly. Everything
    # else — including extensionless files (LICENSE, Makefile), shell-only
    # extensions (.gitignore, .env), executables (.sh → application/x-sh),
    # and binaries the user wants to peek at — gets coerced to text/plain
    # so the preview pane renders the bytes as code, IDE-style.
    ctype = guessed if is_media(guessed) and guessed else "text/plain; charset=utf-8"

    body = target.read_bytes()
    # Skip gzip on already-compressed media (image/video/audio/PDF).
    # Same is_media test that decided ctype above.
    if is_media(guessed):
        encoding: str | None = None
    else:
        body, encoding = _maybe_gzip(handler, body)
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", ctype)
    if encoding:
        handler.send_header("Content-Encoding", encoding)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _send_static(handler: BaseHTTPRequestHandler, rel: str) -> None:
    """Serve a file from STATIC_DIR. ``rel`` is already stripped of the
    leading slash. Path traversal (``..``) is rejected with 403."""
    if ".." in Path(rel).parts:
        _send_json(handler, HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return

    target = (_State.static_dir / rel).resolve()
    try:
        target.relative_to(_State.static_dir.resolve())
    except ValueError:
        _send_json(handler, HTTPStatus.FORBIDDEN, {"error": "forbidden"})
        return

    if not target.is_file():
        _send_json(handler, HTTPStatus.NOT_FOUND, {"error": "not found"})
        return

    ctype, _ = mimetypes.guess_type(str(target))
    if ctype is None:
        ctype = "application/octet-stream"

    body = target.read_bytes()
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    # Silence the default per-request stderr log; we don't need it and it
    # noises up the dev terminal.
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def do_GET(self) -> None:  # noqa: N802 (stdlib API)
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            _send_json(self, HTTPStatus.OK, {"ok": True})
            return

        if path == "/api/manifest":
            _serve_manifest(self, parsed.query)
            return

        if path == "/api/manifest/signature":
            _serve_manifest_signature(self, parsed.query)
            return

        if path == "/api/file":
            _serve_file_api(self, parsed.query)
            return

        if path == "/api/commit":
            _serve_commit_detail(self, parsed.query)
            return

        if path.startswith("/api/"):
            _send_json(self, HTTPStatus.NOT_FOUND, {"error": "unknown api route"})
            return

        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        _send_static(self, rel)

    def do_DELETE(self) -> None:  # noqa: N802 (stdlib API)
        parsed = urlparse(self.path)
        if parsed.path == "/api/manifest/cache":
            _delete_manifest_cache(self, parsed.query)
            return
        _send_json(self, HTTPStatus.NOT_FOUND, {"error": "unknown api route"})


class _Server(ThreadingHTTPServer):
    """Server that doesn't shout into stderr when a client disconnects.

    A browser reloading the tab or giving up on a multi-minute scan of a
    large repo (the Linux kernel manifest is hundreds of MB) closes the
    socket while we're still writing. BaseServer.handle_error would
    print the whole traceback for that, which is benign noise — the
    scan still completed, the response just never reaches a peer that
    cares. Swallow the connection-family errors; let real bugs through.
    """

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc = sys.exc_info()[1]
        if isinstance(
            exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)
        ):
            return
        super().handle_error(request, client_address)


def start_server(
    port: int = 0,
    static_dir: Path | None = None,
    host: str = "127.0.0.1",
) -> tuple[ThreadingHTTPServer, int, Callable[[], None]]:
    """Start the server on a background daemon thread.

    Returns ``(server, bound_port, shutdown_fn)``. ``port=0`` lets the OS
    pick a free port; the bound port is returned so the caller can point
    the browser at the right URL.

    ``host`` defaults to ``127.0.0.1`` for safe local-only binding from
    tests and direct invocations. The container entrypoint passes
    ``host="0.0.0.0"`` so Docker's host port forward can reach the
    server inside the container.

    The server has no startup state — every manifest is computed on
    demand from the query params on `/api/manifest`.
    """
    if static_dir is not None:
        _State.static_dir = static_dir
    # Each call gets a fresh trust set so tests don't leak roots between
    # cases. Production only ever calls start_server once per process.
    with _State.allowed_roots_lock:
        _State.allowed_roots = set()

    server = _Server((host, port), Handler)
    bound_port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def shutdown() -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    return server, bound_port, shutdown
