"""Local HTTP server backing the browser-served frontend.

Serves the Vite-built frontend out of `codecity/static/` and computes a
scan manifest on demand at `/api/manifest?src=…[&branch=…]`. `src` is
either a local absolute path or a git URL; for git URLs, the repo is
cloned into `~/.cache/codecity/clones/` and scanned from there. Bound to
127.0.0.1 only — no remote access.

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
import re
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BufferedIOBase
from pathlib import Path
from typing import Any, Callable, Iterable, Literal
from urllib.parse import parse_qs, urlparse

from codecity.clone import (
    CloneError,
    BranchNotFoundError,
    RepoNotFoundError,
    HostUnreachableError,
    ensure_clone,
)
from codecity.scan import scan_tree, signature_tree
from codecity.types import (
    ErrorResponse,
    FileTooLargeResponse,
    HealthResponse,
    Manifest,
    SignatureResponse,
)

# Cap individual /api/file responses so a stray symlink to a giant blob
# doesn't try to load 10 GB into the browser.
MAX_FILE_BYTES = 100 * 1024 * 1024

# Content-Types we keep verbatim — the browser uses real <img>/<video>/etc.
# tags for these. Everything else gets coerced to text/plain so the
# frontend's preview pane renders the bytes as code, IDE-style.
_MEDIA_PREFIXES = ("image/", "video/", "audio/")
_MEDIA_EXACT = {"application/pdf"}


def _is_media(ctype: str | None) -> bool:
    if not ctype:
        return False
    if ctype in _MEDIA_EXACT:
        return True
    return any(ctype.startswith(p) for p in _MEDIA_PREFIXES)


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
    # Serializes clone-or-update so two concurrent manifest requests for
    # the same URL don't race the working tree. ensure_clone is the cache
    # itself (filesystem-backed); the lock just keeps it consistent.
    clone_lock: threading.Lock = threading.Lock()


JsonBody = (
    Manifest | SignatureResponse | ErrorResponse | FileTooLargeResponse | HealthResponse
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


def _stream_events(  # pyright: ignore[reportUnusedFunction]
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


def _parse_include_all(query: str) -> bool:
    """Parse ?include_all=… as a boolean. Strict: only 'true' (any case)
    and '1' count as on; absent or anything else is off. Used by both
    /api/manifest and /api/manifest/signature."""
    raw = parse_qs(query).get("include_all", [""])[0].strip().lower()
    return raw in ("true", "1")


def _parse_no_cache(query: str) -> bool:
    """Parse ?no_cache=… as a boolean. Same strict semantics as
    _parse_include_all. Maps to scan_tree(use_cache=not <this>)."""
    raw = parse_qs(query).get("no_cache", [""])[0].strip().lower()
    return raw in ("true", "1")


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
    return scan_target, raw_src, None, "local"


def _serve_manifest(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Compute and return the scan manifest for the requested source."""
    resolved = _resolve_scan_target(handler, query)
    if resolved is None:
        return
    scan_target, raw_src, raw_branch, kind = resolved
    include_all = _parse_include_all(query)
    use_cache = not _parse_no_cache(query)

    try:
        manifest = scan_tree(
            str(scan_target),
            include_all=include_all,
            use_cache=use_cache,
        )
    except Exception as e:  # pylint: disable=broad-except
        _send_json(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"scan failed: {e}"})
        return

    # For cache-cloned sources (git URLs), surface the user-friendly source
    # string as display_root so the breadcrumb doesn't show the cache hash.
    if kind == "git":
        manifest["display_root"] = (
            f"{raw_src}@{raw_branch}" if raw_branch else raw_src
        )

    _State.allowed_roots.add(scan_target.resolve())
    _send_json(handler, HTTPStatus.OK, manifest)


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
    include_all = _parse_include_all(query)
    use_cache = not _parse_no_cache(query)

    try:
        sig = signature_tree(
            str(scan_target),
            include_all=include_all,
            use_cache=use_cache,
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

    if not _State.allowed_roots:
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
    for root in _State.allowed_roots:
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
    ctype = guessed if _is_media(guessed) and guessed else "text/plain; charset=utf-8"

    body = target.read_bytes()
    # Skip gzip on already-compressed media (image/video/audio/PDF).
    # Same _is_media test that decided ctype above.
    if _is_media(guessed):
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

        if path.startswith("/api/"):
            _send_json(self, HTTPStatus.NOT_FOUND, {"error": "unknown api route"})
            return

        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        _send_static(self, rel)


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
) -> tuple[ThreadingHTTPServer, int, Callable[[], None]]:
    """Start the server on a background daemon thread.

    Returns ``(server, bound_port, shutdown_fn)``. ``port=0`` lets the OS
    pick a free port; the bound port is returned so the caller can point
    the browser at the right URL.

    The server has no startup state — every manifest is computed on
    demand from the query params on `/api/manifest`.
    """
    if static_dir is not None:
        _State.static_dir = static_dir
    # Each call gets a fresh trust set so tests don't leak roots between
    # cases. Production only ever calls start_server once per process.
    _State.allowed_roots = set()

    server = _Server(("127.0.0.1", port), Handler)
    bound_port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def shutdown() -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    return server, bound_port, shutdown
