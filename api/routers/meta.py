"""Server meta endpoints: GET /api/health (liveness), GET /api/config
(boot-time feature flags) and GET /api/discover (the curated repo list).
Grouped here because all three are tiny server-info routes, not domain logic."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter

from api import __version__
from api.config import (
    MAX_BATCH_PATHS,
    discover_enabled,
    discover_file,
    hosted,
    local_repos_allowed,
)
from api.models.responses import (
    ConfigResponse,
    DiscoverEntry,
    DiscoverResponse,
    HealthResponse,
)

router = APIRouter(prefix="/api", tags=["meta"])

logger = logging.getLogger("codecity.meta")


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


def _curated_repos() -> list[DiscoverEntry]:
    """The curated list, or empty if it's switched off, absent or unreadable.

    Every failure is empty-and-logged rather than raised: Discover is one tab
    on the landing page, and a typo in a hand-edited JSON file must not be
    able to take the landing down with it."""
    if not discover_enabled():
        return []
    path = discover_file()
    try:
        entries = json.loads(path.read_text())
        return [DiscoverEntry.model_validate(entry) for entry in entries]
    except FileNotFoundError:
        logger.warning("discover list not found at %s", path)
    except (OSError, ValueError, TypeError) as e:
        logger.warning("discover list at %s is unreadable: %s", path, e)
    return []


@router.get("/discover", response_model=DiscoverResponse)
def discover() -> DiscoverResponse:
    return DiscoverResponse(repos=_curated_repos())
