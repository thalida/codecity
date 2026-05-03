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

# Where the Vite build output lives. Resolved at import time so tests can
# spin up a server without an installed wheel layout.
STATIC_DIR = Path(__file__).resolve().parent / "static"


class _State:
    """Module-level state shared by every handler instance."""
    manifest: dict[str, Any] = {}
    static_dir: Path = STATIC_DIR


def _send_json(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


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
        path = self.path.split("?", 1)[0]

        if path == "/api/health":
            _send_json(self, HTTPStatus.OK, {"ok": True})
            return

        if path == "/api/manifest":
            _send_json(self, HTTPStatus.OK, _State.manifest)
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
) -> tuple[ThreadingHTTPServer, int, Callable[[], None]]:
    """Start the server on a background daemon thread.

    Returns ``(server, bound_port, shutdown_fn)``. ``port=0`` lets the OS
    pick a free port; the bound port is returned so the caller can point
    the webview at the right URL.
    """
    if static_dir is not None:
        _State.static_dir = static_dir
    _State.manifest = manifest

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    bound_port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def shutdown() -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    return server, bound_port, shutdown
