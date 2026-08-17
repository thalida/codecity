# `api/routers` — the HTTP surface

Every route codecity serves is in one of these. `app.py` imports the modules and
registers `.router` off each; order matters there, because `static` is a
catch-all that owns every non-`/api` path and must come last.

| module        | routes                                                             |
| ------------- | ------------------------------------------------------------------ |
| `manifest.py` | `/api/manifest`, `/api/manifest/signature`, `/api/manifest/cached` |
| `timeline.py` | `/api/timeline`                                                    |
| `file.py`     | `/api/file`, `/api/images`, `/api/fingerprints`                    |
| `commit.py`   | `/api/commit`                                                      |
| `branches.py` | `/api/branches`                                                    |
| `meta.py`     | `/api/health`, `/api/config`, `/api/discover`                      |
| `static.py`   | the SPA and its index fallback                                     |
| `sse.py`      | not a router — the worker plumbing both streams run on             |

## An SSE stream cannot report a 4xx

`EventSource` can't read the body of an error response, so once a stream has
begun, every failure has to become an `error` **event** rather than a status
code. That is why the manifest route classifies and validates the source before
starting work, and why `ResolveError` carries a suggested status the routes only
use on the non-streaming paths.

The client keys its remedy on `ErrorCode`, never on message text. Only failures
the UI answers differently earn a member.

## Long work runs on a thread, and the client owns its lifetime

`sse.stream` is the shared machinery: it runs the blocking scan or timeline
build on a worker thread, carries events back through a queue, polls for a
disconnect, and cancels the work when one happens rather than letting it run on
as an orphan.

`on_complete` fires only when the work finished **and** the client was still
there. That is exactly the condition a cache write needs — on a disconnect the
result is half-delivered at best, and on an error there is no result.

Cache reads are gated by `no_cache`; cache **writes** never are. A skip-cache
scan still leaves the cache fresh.

## Where the repo's name comes from

Before a scan, `src` is all there is, so progress events carry a label derived
from it. The scanner then bakes the canonical `tree.name` from the git remote,
and every consumer reads that. Nothing else derives a name — if you find
yourself parsing a URL for a display string, use `utils.labels`.

## Serving bytes

`/api/file` and the two batch routes serve only from registered scan roots.
There is no global filesystem read: a path must resolve under a root that a
successful manifest scan registered.

Media is returned with an explicit `Content-Encoding: identity` so the app-wide
GZipMiddleware skips it. Re-deflating already-compressed bytes costs CPU for
about nothing. Everything else is coerced to `text/plain` so the preview pane
renders it as code.

The batch routes are not plurals of `/api/file`. They inline base64, serve
images only, and silently omit anything they can't serve — the client falls back
to the streaming GET for those. They exist so a media-heavy repo doesn't exhaust
the browser's HTTP/1.1 connection pool.

Raw binary bytes never leave the server: `/api/fingerprints` reads only a file's
head and returns a generated image of its byte pattern.

## Time travel

`?ref=` reconstructs the manifest as of a commit instead of scanning the working
tree. The ref is resolved to a sha first, because that sha is both the cache key
and the early "bad ref" error.

That path emits no skeleton events. The city is already drawn for the live tree,
so a `manifest-partial` would just flash placeholders over it.
