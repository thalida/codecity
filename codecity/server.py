"""Local HTTP server backing the browser-served frontend.

Serves the Vite-built frontend out of `codecity/static/` and computes a
scan manifest on demand at `/api/manifest?path=…` (or `?clone=URL` for a
remote repo). Bound to 127.0.0.1 only — no remote access.

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

import json
import mimetypes
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from codecity.clone import CloneError, ensure_clone
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
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def _resolve_clone(url: str, branch: str | None) -> Path:
    """Clone-or-update under the cache lock so concurrent requests for the
    same (url, branch) don't trample each other's working tree. Always
    runs ensure_clone so upstream commits are pulled even on cache hits."""
    with _State.clone_lock:
        return ensure_clone(url, branch)


def _resolve_scan_target(
    handler: BaseHTTPRequestHandler, query: str
) -> Path | None:
    """Parse ?path=… / ?clone=…&branch=… and return the resolved scan root.

    Sends the appropriate 4xx/5xx JSON error and returns None if the
    params are missing/conflicting, the path doesn't resolve, or the
    clone fails. Shared by /api/manifest and /api/manifest/signature.
    """
    params = parse_qs(query)
    raw_path = params.get("path", [""])[0]
    raw_clone = params.get("clone", [""])[0]
    raw_branch = params.get("branch", [""])[0] or None

    if raw_clone and raw_path:
        _send_json(
            handler,
            HTTPStatus.BAD_REQUEST,
            {"error": "pass either 'path' or 'clone', not both"},
        )
        return None
    if not raw_clone and not raw_path:
        _send_json(
            handler,
            HTTPStatus.BAD_REQUEST,
            {"error": "missing 'path' or 'clone' query param"},
        )
        return None

    if raw_clone:
        try:
            return _resolve_clone(raw_clone, raw_branch)
        except CloneError as e:
            _send_json(handler, HTTPStatus.BAD_GATEWAY, {"error": str(e)})
            return None

    try:
        scan_target = Path(raw_path).resolve(strict=True)
    except (OSError, RuntimeError):
        _send_json(handler, HTTPStatus.NOT_FOUND, {"error": "path not found"})
        return None
    if not scan_target.is_dir():
        _send_json(
            handler, HTTPStatus.BAD_REQUEST, {"error": "path is not a directory"}
        )
        return None
    return scan_target


def _serve_manifest(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Compute and return the scan manifest for the requested path or clone."""
    scan_target = _resolve_scan_target(handler, query)
    if scan_target is None:
        return

    try:
        manifest = scan_tree(str(scan_target))
    except Exception as e:  # pylint: disable=broad-except
        _send_json(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"scan failed: {e}"})
        return

    _State.allowed_roots.add(scan_target.resolve())
    _send_json(handler, HTTPStatus.OK, manifest)


def _serve_manifest_signature(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Cheap variant of /api/manifest — returns just {root, scanned_at, signature}.

    Used by the frontend's live-update poll: hitting this every few
    seconds avoids paying for per-file content reads and per-file git
    history walks on every tick. The client only fetches the full
    manifest when the signature changes.
    """
    scan_target = _resolve_scan_target(handler, query)
    if scan_target is None:
        return

    try:
        sig = signature_tree(str(scan_target))
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
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", ctype)
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

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    bound_port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def shutdown() -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    return server, bound_port, shutdown
