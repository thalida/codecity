"""SPA static serving + index fallback.

API routes are registered before this is mounted, so anything reaching
here is either a real static asset or a client-side route -> index.html.
Path traversal is rejected. /api/* that falls through is a 404 JSON.

A path with a file extension that does not exist on disk is a genuine
404 (e.g. /openapi.json must not be masked by the SPA index); only
extension-less route-like paths fall back to index.html."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse


def make_static_router(static_dir: Path) -> APIRouter:
    static_dir = static_dir.resolve()
    router = APIRouter()  # fresh per app — never a module-level singleton

    def serve(full_path: str, request: Request) -> Response:
        # Never serve API paths from here.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="unknown api route")
        if ".." in Path(full_path).parts:
            raise HTTPException(status_code=403, detail="forbidden")
        rel = full_path or "index.html"
        target = (static_dir / rel).resolve()
        try:
            target.relative_to(static_dir)
        except ValueError:
            raise HTTPException(status_code=403, detail="forbidden")
        if target.is_file():
            ctype, _ = mimetypes.guess_type(str(target))
            return FileResponse(target, media_type=ctype or "application/octet-stream")
        # A missing path WITH a file extension is a real 404, not an SPA route.
        if Path(full_path).suffix:
            raise HTTPException(status_code=404, detail="not found")
        # SPA fallback: unknown extension-less route -> index.html.
        index = static_dir / "index.html"
        if index.is_file():
            return FileResponse(index, media_type="text/html")
        raise HTTPException(status_code=404, detail="not found")

    # Register via add_api_route (not the @router.get decorator) so `serve` is
    # referenced rather than a dangling nested function — no pyright ignore.
    # include_in_schema=False: this is the SPA file server, not an API endpoint,
    # so the `/{full_path}` catch-all stays out of the OpenAPI schema / Scalar docs.
    router.add_api_route(
        "/{full_path:path}",
        serve,
        methods=["GET"],
        include_in_schema=False,
    )
    return router
