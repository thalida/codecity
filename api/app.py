"""FastAPI app factory.

Order matters: API routers register first, the SPA static catch-all last
(it owns every non-/api path). Swagger + default ReDoc are disabled;
Scalar is mounted at /api/docs and OpenAPI JSON relocated to
/api/openapi.json (the source for the generated TS types)."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from api.core.config import GZIP_MIN_BYTES
from api.models.responses import ErrorResponse
from api.routers import branches, commit, file, manifest, meta, timeline
from api.core.middleware import SSEGZipMiddleware
from api.routers.static import make_static_router

DEFAULT_STATIC_DIR = Path(__file__).resolve().parent / "static"


class _HealthcheckAccessFilter(logging.Filter):
    """Drop the every-10s /api/health probe from the access log; keep real
    requests. uvicorn.access formats with args = (client, method, path, ...)."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        return not (
            isinstance(args, tuple)
            and len(args) >= 3
            and str(args[2]).startswith("/api/health")
        )


# Install once at import — covers every entry path (prod, --reload, uvicorn app:app).
logging.getLogger("uvicorn.access").addFilter(_HealthcheckAccessFilter())

_SCALAR_HTML = """<!doctype html><html><head><title>CodeCity API</title>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
</head><body><script id="api-reference" data-url="/api/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>"""


def _scalar_docs() -> HTMLResponse:
    """Serve the Scalar API-reference UI at /api/docs."""
    return HTMLResponse(_SCALAR_HTML)


async def _api_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Render HTTPExceptions as a uniform ErrorResponse JSON body (so an
    unknown /api/* path is a 404 JSON, not HTML)."""
    status = exc.status_code if isinstance(exc, HTTPException) else 500
    detail = exc.detail if isinstance(exc, HTTPException) else "internal server error"
    body = ErrorResponse(error=detail, code=getattr(exc, "code", None))
    # exclude_none so an uncoded error is absent-or-value on the wire, the way
    # the stream's error event already is.
    return JSONResponse(status_code=status, content=body.model_dump(exclude_none=True))


def create_app(static_dir: Path | None = None) -> FastAPI:
    # TRUST is deliberately NOT reset here: the factory must be side-effect-free
    # on session auth state. Tests isolate it via an autouse fixture.
    app = FastAPI(
        title="CodeCity API",
        docs_url=None,  # disable Swagger UI
        redoc_url=None,  # disable default ReDoc
        openapi_url="/api/openapi.json",
    )
    # GZip compresses ordinary responses (it skips text/event-stream); the SSE
    # middleware stream-gzips the manifest event stream with per-event flush.
    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MIN_BYTES)
    app.add_middleware(SSEGZipMiddleware)

    # Registered by reference (not as decorated nested functions) so they are
    # plain module-level handlers — no pyright reportUnusedFunction ignore.
    app.add_api_route("/api/docs", _scalar_docs, include_in_schema=False)
    app.add_exception_handler(HTTPException, _api_error_handler)

    app.include_router(meta.router)
    app.include_router(file.router)
    app.include_router(commit.router)
    app.include_router(branches.router)
    app.include_router(manifest.router)
    app.include_router(timeline.router)
    app.include_router(make_static_router(static_dir or DEFAULT_STATIC_DIR))
    return app


# Module-level instance for `uvicorn api.app:app` (prod + --reload).
app = create_app()
