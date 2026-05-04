"""Local HTTP server backing the PyWebView window.

Serves the Vite-built frontend out of `codecity/static/` and the scanned
manifest at `/api/manifest`. Bound to 127.0.0.1 only — no remote access.

Threading: ``ThreadingHTTPServer`` so the manifest fetch and any
sub-resource requests don't serialize on each other. The server runs on
a daemon thread (started by `start_server`) so the main thread can host
the PyWebView event loop on macOS.
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
    manifest: dict[str, Any] = {}
    static_dir: Path = STATIC_DIR
    # Absolute path of the directory the user asked us to scan. /api/file
    # rejects any request whose target resolves outside this root.
    scan_root: Path | None = None


def _send_json(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def _serve_file_api(handler: BaseHTTPRequestHandler, query: str) -> None:
    """Serve a file from the user's filesystem, restricted to paths inside
    ``_State.scan_root``. Path-traversal and symlink-escape attempts are
    caught by ``Path.resolve()`` + ``relative_to()``."""
    params = parse_qs(query)
    raw = params.get("path", [""])[0]
    if not raw:
        _send_json(handler, HTTPStatus.BAD_REQUEST, {"error": "missing 'path' param"})
        return

    if _State.scan_root is None:
        _send_json(
            handler,
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"error": "server not initialized with a scan root"},
        )
        return

    try:
        target = Path(raw).resolve(strict=True)
    except (OSError, RuntimeError):
        _send_json(handler, HTTPStatus.NOT_FOUND, {"error": "not found"})
        return

    root = _State.scan_root.resolve()
    try:
        target.relative_to(root)
    except ValueError:
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

    ctype, _ = mimetypes.guess_type(str(target))
    # Media types (image/video/audio/pdf) keep their guessed MIME so the
    # browser can hand them to <img>/<video>/<embed> directly. Everything
    # else — including extensionless files (LICENSE, Makefile), shell-only
    # extensions (.gitignore, .env), executables (.sh → application/x-sh),
    # and binaries the user wants to peek at — gets coerced to text/plain
    # so the preview pane renders the bytes as code, IDE-style.
    if not _is_media(ctype):
        ctype = "text/plain; charset=utf-8"

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
            _send_json(self, HTTPStatus.OK, _State.manifest)
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
    manifest: dict[str, Any],
    port: int = 0,
    static_dir: Path | None = None,
    scan_root: Path | None = None,
) -> tuple[ThreadingHTTPServer, int, Callable[[], None]]:
    """Start the server on a background daemon thread.

    Returns ``(server, bound_port, shutdown_fn)``. ``port=0`` lets the OS
    pick a free port; the bound port is returned so the caller can point
    the webview at the right URL.

    ``scan_root`` is required if /api/file should serve anything — it's
    the trust boundary for path validation.
    """
    if static_dir is not None:
        _State.static_dir = static_dir
    _State.manifest = manifest
    _State.scan_root = scan_root

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    bound_port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def shutdown() -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    return server, bound_port, shutdown
