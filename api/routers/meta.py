"""Server meta endpoints: GET /api/health (liveness) and GET /api/config
(boot-time feature flags). Grouped here because both are tiny server-info
routes, not domain logic."""

from __future__ import annotations

from fastapi import APIRouter

from api import __version__
from api.config import MAX_BATCH_PATHS, hosted, local_repos_allowed
from api.models.responses import ConfigResponse, HealthResponse

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True)


@router.get("/config", response_model=ConfigResponse)
def config() -> ConfigResponse:
    return ConfigResponse(
        allowLocalRepos=local_repos_allowed(),
        hosted=hosted(),
        maxBatchPaths=MAX_BATCH_PATHS,
        version=__version__,
    )
