"""FastAPI app factory.

Order matters: API routers register first, the SPA static catch-all last
(it owns every non-/api path). Swagger + default ReDoc are disabled;
Scalar is mounted at /api/docs and OpenAPI JSON relocated to
/api/openapi.json (the source for the generated TS types)."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from api.config import GZIP_MIN_BYTES
from api.models.responses import ErrorResponse
from api.routers import commit, file, manifest, meta
from api.static import make_static_router

DEFAULT_STATIC_DIR = Path(__file__).resolve().parent / "static"

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
    return JSONResponse(status_code=status, content=ErrorResponse(error=detail).model_dump())


def create_app(static_dir: Path | None = None) -> FastAPI:
    # NB: the process-global TRUST set is intentionally NOT reset here — the
    # factory must be side-effect-free on session auth state. A fresh process
    # starts with an empty TRUST; tests isolate it via an autouse fixture.
    app = FastAPI(
        title="CodeCity API",
        docs_url=None,           # disable Swagger UI
        redoc_url=None,          # disable default ReDoc
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MIN_BYTES)

    # Registered by reference (not as decorated nested functions) so they are
    # plain module-level handlers — no pyright reportUnusedFunction ignore.
    app.add_api_route("/api/docs", _scalar_docs, include_in_schema=False)
    app.add_exception_handler(HTTPException, _api_error_handler)

    app.include_router(meta.router)
    app.include_router(file.router)
    app.include_router(commit.router)
    app.include_router(manifest.router)
    app.include_router(make_static_router(static_dir or DEFAULT_STATIC_DIR))
    return app


# Module-level instance for `uvicorn api.app:app` (prod + --reload).
app = create_app()
