"""GET /api/health and GET /api/config."""
from __future__ import annotations

from fastapi import APIRouter

from api.config import local_repos_allowed
from api.models.responses import ConfigResponse, HealthResponse

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True)


@router.get("/config", response_model=ConfigResponse)
def config() -> ConfigResponse:
    return ConfigResponse(allowLocalRepos=local_repos_allowed())
