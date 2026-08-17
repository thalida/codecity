"""Streaming gzip for Server-Sent Events.

Starlette's GZipMiddleware deliberately skips `text/event-stream` because it
buffers output — which would stall the live scan stream. This middleware fills
that gap: it gzip-compresses an SSE response but flushes after every event
(Z_SYNC_FLUSH), so the skeleton + progress events still arrive early. Browsers
(and httpx) decode `Content-Encoding: gzip` on an EventSource transparently.

Large manifests (big repos) compress ~9x, so this is a real transfer win; small
streams pay only a few bytes of flush overhead per event. Only engages when the
client sends `Accept-Encoding: gzip` (every browser does) — a raw socket or odd
proxy that doesn't falls back to identity.

gzip (stdlib) over brotli: brotli would shave another ~15-25% but needs a new
dependency; gzip captures the bulk of the win with zero deps. Swappable here if
that ever changes.
"""

from __future__ import annotations

import zlib

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_GZIP_LEVEL = 6
_GZIP_WBITS = 31  # 15 (max window) + 16 → gzip header/trailer (not raw deflate)


class SSEGZipMiddleware:
    """Stream-gzip `text/event-stream` responses, flushing per event."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or "gzip" not in Headers(scope=scope).get(
            "accept-encoding", ""
        ):
            await self.app(scope, receive, send)
            return

        # Set once the response turns out to be an SSE stream; stays None (and
        # the body passes through untouched) for every other response.
        compressor = None

        async def send_compressed(message: Message) -> None:
            nonlocal compressor
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                ctype = headers.get("content-type", "")
                if (
                    ctype.startswith("text/event-stream")
                    and "content-encoding" not in headers
                ):
                    compressor = zlib.compressobj(
                        _GZIP_LEVEL, zlib.DEFLATED, _GZIP_WBITS
                    )
                    headers["content-encoding"] = "gzip"
                    headers.add_vary_header("accept-encoding")
                await send(message)
            elif message["type"] == "http.response.body" and compressor is not None:
                body: bytes = message.get("body", b"")
                more: bool = message.get("more_body", False)
                # Z_SYNC_FLUSH per event so it reaches the client now; Z_FINISH
                # on the final body to write the gzip trailer.
                chunk = compressor.compress(body)
                chunk += compressor.flush(zlib.Z_SYNC_FLUSH if more else zlib.Z_FINISH)
                await send(
                    {"type": "http.response.body", "body": chunk, "more_body": more}
                )
            else:
                await send(message)

        await self.app(scope, receive, send_compressed)
