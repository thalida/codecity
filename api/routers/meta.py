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
    featured_repo,
    hosted,
    local_repos_allowed,
)
from api.models.responses import (
    ConfigResponse,
    DiscoverEntry,
    DiscoverResponse,
    HealthResponse,
)
from api.git import label_from_source

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
        featuredRepo=featured_repo(),
    )


def _curated_repos() -> list[DiscoverEntry]:
    """The curated file's entries, or empty if it's absent or unreadable.

    Every failure is empty-and-logged rather than raised: Discover is one tab
    on the landing page, and a typo in a hand-edited JSON file must not be
    able to take the landing down with it."""
    path = discover_file()
    try:
        entries = json.loads(path.read_text())
        return [DiscoverEntry.model_validate(entry) for entry in entries]
    except FileNotFoundError:
        logger.warning("discover list not found at %s", path)
    except (OSError, ValueError, TypeError) as e:
        logger.warning("discover list at %s is unreadable: %s", path, e)
    return []


def _with_featured(repos: list[DiscoverEntry]) -> list[DiscoverEntry]:
    """Mark the featured repo in the list, adding it if the curated file didn't
    already name it, and move it to the front.

    It leads because the landing is rendering it: a visitor who wonders what
    they're looking at should find it as the first row, not hunt for the badge.
    Matched by URL so curating it into the file by hand marks that entry rather
    than producing a near-duplicate row."""
    featured = featured_repo()
    if not featured:
        return repos
    rest = [r for r in repos if r.url != featured]
    existing = next((r for r in repos if r.url == featured), None)
    label = existing.label if existing else label_from_source(featured)
    return [DiscoverEntry(url=featured, label=label, featured=True), *rest]


@router.get("/discover", response_model=DiscoverResponse)
def discover() -> DiscoverResponse:
    # Switching Discover off hides the tab, featured row included. It does not
    # touch the landing's backdrop, which reads the same env var off /api/config
    # because rendering a city is not a Discover feature.
    if not discover_enabled():
        return DiscoverResponse(repos=[])
    return DiscoverResponse(repos=_with_featured(_curated_repos()))
