"""Server-Sent Events: how an event is shaped, and how the work behind one runs.

The scan and timeline builds are synchronous and long. Both need the same
scaffolding — a thread to run the work, a queue to carry events back to the
event loop, a watch on the client so a disconnect cancels the work rather than
letting it run on as an orphan, and a chance to persist the result afterwards
only if the client actually received it — and both emit events in the same
shape, so that lives here too rather than in whichever route was written first.
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, AsyncIterator, Awaitable, Callable

from fastapi import Request
from pydantic import BaseModel

from api.core.constants import ErrorCode, ScanEvent, TimelineEvent
from api.models.events import ErrorEvent

# How long to wait on the queue before re-checking whether the client is gone.
# Bounds how long a disconnect goes unnoticed; the work itself is unaffected.
_DISCONNECT_POLL_S = 0.5
# How long to wait for the worker to notice `cancel` and unwind before giving
# up on it. It is a daemon thread, so a straggler cannot hold the process open.
_WORKER_JOIN_S = 2.0

Put = Callable[[dict[str, Any] | None], None]
Work = Callable[[Put, threading.Event], None]


async def stream(
    request: Request,
    work: Work,
    *,
    on_complete: Callable[[], Awaitable[None]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield the events `work` produces, until it finishes or the client leaves.

    `work` runs on a worker thread and is handed two things: `put`, to emit an
    event (call it with None when there is nothing left to send), and a
    `threading.Event` it should poll to notice cancellation.

    `on_complete` runs only when the stream ended because the work finished and
    the client was still there — which is what makes it the right place to write
    a cache. On a disconnect the result is half-delivered at best, and on an
    error there is no result at all.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    cancel = threading.Event()

    def put(item: dict[str, Any] | None) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, item)

    worker = threading.Thread(target=work, args=(put, cancel), daemon=True)
    worker.start()

    disconnected = False
    try:
        while True:
            if await request.is_disconnected():
                # Set immediately, not in the finally: an in-flight git fetch
                # should stop now rather than after the join is already waiting.
                disconnected = True
                cancel.set()
                break
            try:
                item = await asyncio.wait_for(queue.get(), _DISCONNECT_POLL_S)
            except asyncio.TimeoutError:
                continue
            if item is None:
                break
            yield item
    finally:
        cancel.set()
        await asyncio.to_thread(worker.join, _WORKER_JOIN_S)

    if not disconnected and on_complete is not None:
        await on_complete()


def _as_json(obj: object) -> Any:
    """json.dumps hook: the manifest and timeline payloads are Pydantic models,
    everything else in an event payload is already a JSON primitive."""
    if isinstance(obj, BaseModel):
        return obj.model_dump()
    raise TypeError(f"not JSON-serialisable: {type(obj).__name__}")


def event(name: ScanEvent | TimelineEvent, payload: dict[str, Any]) -> dict[str, Any]:
    """An sse-starlette event dict: {'event': name, 'data': json-string}.

    None values are dropped, so every event matches what its model documents:
    absent-or-value, never null. A progress line carrying no object count would
    otherwise ship `"objects": null` for the client to special-case."""
    return {
        "event": name,
        "data": json.dumps(
            {k: v for k, v in payload.items() if v is not None}, default=_as_json
        ),
    }


def error(message: str, code: ErrorCode | None = None) -> dict[str, Any]:
    """An `error` event, single-sourced through the ErrorEvent model so the
    stream and the JSON routes describe a failure the same way."""
    return event(
        ScanEvent.ERROR,
        ErrorEvent(error=message, code=code).model_dump(exclude_none=True),
    )
