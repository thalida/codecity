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


# What the browser tells us about who made the request. Page JavaScript cannot
# set it (it is a forbidden header), so cross-site here is trustworthy.
_SEC_FETCH_SITE = b"sec-fetch-site"
_CROSS_SITE = b"cross-site"

# Measured against a production build, not the dev server: Vite's HMR needs
# inline script and eval, so a policy tuned there would allow both forever.
_DIRECTIVES: tuple[str, ...] = (
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    # A README points its images and video wherever it likes; data: is the
    # bundled icon set, blob: the facade and fingerprint textures.
    "img-src 'self' data: blob: https:",
    "media-src 'self' https:",
    # The file preview shows a PDF through <embed>, which 'none' would kill.
    "object-src 'self'",
)

_SHARED: tuple[tuple[str, str], ...] = (
    ("x-content-type-options", "nosniff"),
    ("referrer-policy", "strict-origin-when-cross-origin"),
    ("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()"),
)


def _headers(csp: str, frame_options: str) -> tuple[tuple[str, str], ...]:
    """One response's full header set. X-Frame-Options rides along with
    frame-ancestors: the header is the one browsers still read, the directive
    is the one that supersedes it where both apply."""
    return (
        ("content-security-policy", csp),
        ("x-frame-options", frame_options),
    ) + _SHARED


_APP_HEADERS = _headers("; ".join(_DIRECTIVES + ("frame-ancestors 'none'",)), "DENY")

# Chrome's PDF viewer refuses to paint an <embed> under 'none', even same-origin;
# framing /api/file from anywhere else is SameSiteApiMiddleware's 403 already.
_FILE_HEADERS = _headers(
    "; ".join(_DIRECTIVES + ("frame-ancestors 'self'",)), "SAMEORIGIN"
)

# The API reference is a third-party bundle from a CDN, which the app's own
# policy blocks outright; framing is the half of it that still applies.
_DOCS_HEADERS = _headers("frame-ancestors 'none'", "DENY")

_HEADERS_BY_PATH: dict[str, tuple[tuple[str, str], ...]] = {
    "/api/file": _FILE_HEADERS,
    "/api/docs": _DOCS_HEADERS,
}


class SecurityHeadersMiddleware:
    """Stamp the framing, sniffing and content-source headers on every response.

    Here rather than only on the deploy's proxy, so they hold wherever the
    container runs — a local `just run`, a tunnel, someone else's host.

    The policy is what `vite build`'s output actually asks for. In that build
    the two workers are their own chunks rather than blob: URLs, no bundled
    path reaches eval or `new Function`, stylesheets are external files and
    every style the app writes goes through the CSSOM (which CSP does not
    police), and both SSE streams plus every fetch are same-origin. What needs
    more than 'self' is therefore small and listed above: a README's own
    assets, the icon set's data: URIs, the blob: textures the facades build,
    and the <embed> the PDF preview renders into."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_headers = _HEADERS_BY_PATH.get(scope["path"], _APP_HEADERS)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in response_headers:
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)


class SameSiteApiMiddleware:
    """Refuse /api requests a browser reports as coming from another site.

    No CORS headers already stop another origin from READING a response, but
    nothing stopped it causing one: an <img src> pointed at /api/file made the
    server do the work and hand a repo's bytes to whatever tag asked. A request
    with no Sec-Fetch-Site is not a browser's, so it passes: curl and the test
    client are not the thing this defends against."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            site = Headers(scope=scope).get("sec-fetch-site")
            if site == _CROSS_SITE.decode():
                await _forbidden(send)
                return
        await self.app(scope, receive, send)


async def _forbidden(send: Send) -> None:
    """The app's own error shape, hand-rolled: middleware sits outside the
    exception handler that would otherwise render it."""
    body = b'{"error":"cross-site requests are not served"}'
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
