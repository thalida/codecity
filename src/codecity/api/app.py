from pathlib import Path

from fastapi import FastAPI, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from codecity.analysis import (
    City,
    FileMetrics,
    calculate_file_metrics,
    generate_city_layout,
    get_file_git_history,
    get_repo_files,
)
from codecity.app import APP_DIR


def create_app() -> FastAPI:
    app = FastAPI(title="CodeCity API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.websocket("/ws")
    async def websocket_route(
        websocket: WebSocket, repo_path: str | None = None
    ) -> None:
        from codecity.api.websocket import websocket_endpoint

        # Use app.state.repo_path as default if not provided
        if repo_path is None and hasattr(app.state, "repo_path"):
            repo_path = str(app.state.repo_path)

        await websocket_endpoint(websocket, repo_path)

    @app.get("/api/city")
    def get_city(
        repo_path: str | None = Query(None, description="Path to git repository"),
    ) -> JSONResponse:
        # Use app.state.repo_path as default if not provided
        if repo_path is None:
            if hasattr(app.state, "repo_path"):
                repo_path = str(app.state.repo_path)
            else:
                return JSONResponse(
                    status_code=400,
                    content={"error": "repo_path is required"},
                )
        repo = Path(repo_path).resolve()

        if not repo.exists():
            return JSONResponse(
                status_code=404,
                content={"error": f"Repository not found: {repo_path}"},
            )

        files = get_repo_files(repo)
        file_metrics: list[FileMetrics] = []

        for file_path in files:
            full_path = repo / file_path
            if not full_path.is_file():
                continue

            metrics_dict = calculate_file_metrics(full_path)
            history = get_file_git_history(repo, file_path)

            file_metrics.append(
                FileMetrics(
                    path=file_path,
                    lines_of_code=metrics_dict["lines_of_code"],
                    avg_line_length=metrics_dict["avg_line_length"],
                    language=metrics_dict["language"],
                    created_at=history["created_at"],
                    last_modified=history["last_modified"],
                )
            )

        city = generate_city_layout(file_metrics, str(repo))

        return JSONResponse(content=_city_to_dict(city))

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(APP_DIR / "index.html")

    # Mount static files
    app.mount("/", StaticFiles(directory=APP_DIR), name="static")

    return app


def _city_to_dict(city: City) -> dict:
    """Convert City dataclass to JSON-serializable dict."""

    def street_to_dict(street) -> dict:
        return {
            "path": street.path,
            "name": street.name,
            "x": street.x,
            "z": street.z,
            "width": street.width,
            "length": street.length,
            "buildings": [
                {
                    "file_path": b.file_path,
                    "height": b.height,
                    "width": b.width,
                    "depth": b.depth,
                    "language": b.language,
                    "created_at": b.created_at.isoformat(),
                    "last_modified": b.last_modified.isoformat(),
                    "x": b.x,
                    "z": b.z,
                }
                for b in street.buildings
            ],
            "substreets": [street_to_dict(s) for s in street.substreets],
        }

    return {
        "repo_path": city.repo_path,
        "generated_at": city.generated_at.isoformat(),
        "root": street_to_dict(city.root),
    }
