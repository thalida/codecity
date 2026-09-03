"""GET /api/timeline — the commit-scrub bundle, as an SSE stream.

One route, because building the bundle is a different job from scanning a tree:
it walks every commit, resolves every blob those commits touched, and assembles
a union manifest the client replays against. The work itself is api/scan's; this
is the streaming wrapper over it.
"""

import logging

from fastapi import APIRouter, Query, Request
from sse_starlette.sse import EventSourceResponse

from api.models.events import TimelineStreamMessage
from api.scan import timeline_events, normalize_excludes

router = APIRouter(prefix="/api", tags=["timeline"])

logger = logging.getLogger("codecity.timeline")


@router.get(
    "/timeline",
    responses={
        200: {
            "description": (
                "Server-Sent Events stream (`text/event-stream`). Named events "
                "and their JSON `data` payloads: `timeline-progress` "
                "(TimelineProgressEvent, one or more while the history walk / "
                "blob resolution run), `timeline-complete` (TimelineCompleteEvent, "
                "the full bundle), `error` (ErrorEvent). A warm cache hit emits "
                "only `timeline-complete`, no progress. The client closes the "
                "connection on `timeline-complete`/`error`."
            ),
            "model": TimelineStreamMessage,
        },
    },
)
async def timeline(
    request: Request,
    src: str = Query(...),
    branch: str | None = Query(None),
    no_cache: bool = Query(False),
    exclude: list[str] = Query(default_factory=list),
) -> EventSourceResponse:
    return EventSourceResponse(
        timeline_events(request, src, branch, not no_cache, normalize_excludes(exclude))
    )
