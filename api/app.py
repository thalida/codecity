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
from api.routers import commit, file, health
from api.security import TRUST
from api.static import make_static_router

DEFAULT_STATIC_DIR = Path(__file__).resolve().parent / "static"

_SCALAR_HTML = """<!doctype html><html><head><title>CodeCity API</title>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
</head><body><script id="api-reference" data-url="/api/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>"""


def create_app(static_dir: Path | None = None) -> FastAPI:
    TRUST.reset()  # fresh trust set per process / per test app
    app = FastAPI(
        title="CodeCity API",
        docs_url=None,           # disable Swagger UI
        redoc_url=None,          # disable default ReDoc
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MIN_BYTES)

    @app.get("/api/docs", include_in_schema=False)
    def scalar_docs() -> HTMLResponse:  # pyright: ignore[reportUnusedFunction]
        return HTMLResponse(_SCALAR_HTML)

    # JSON 404 for unknown /api/* (HTTPException detail -> {"error": ...}).
    @app.exception_handler(HTTPException)
    async def _http_exc(  # pyright: ignore[reportUnusedFunction]
        _req: Request, exc: HTTPException
    ) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

    app.include_router(health.router)
    app.include_router(file.router)
    app.include_router(commit.router)
    # NOTE: manifest router added in later tasks, BEFORE static.
    app.include_router(make_static_router(static_dir or DEFAULT_STATIC_DIR))
    return app
