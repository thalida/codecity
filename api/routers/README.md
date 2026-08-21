# `api/routers` — the HTTP surface

Every route codecity serves is in one of these. `app.py` imports the modules and
registers `.router` off each; order matters there, because `static` is a
catch-all that owns every non-`/api` path and must come last.

| module        | routes                                                             |
| ------------- | ------------------------------------------------------------------ |
| `manifest.py` | `/api/manifest`, `/api/manifest/signature`, `/api/manifest/cached` |
| `timeline.py` | `/api/timeline`                                                    |
| `file.py`     | `/api/file`, `/api/fingerprint`                                    |
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

`/api/file` and `/api/fingerprint` address a file the way the manifest does: the
`src` (+ `branch`) it was built for, and a path relative to that repo's root.
One call decides the whole thing, `git.repo_file`, and it answers four questions
in order:

1. **Which directory?** A remote hashes to `CLONES_ROOT/sha256(url\0branch)[:16]`
   — string math, no I/O, so a read can never start a clone. A local path is
   itself, and only when `CODECITY_ALLOW_LOCAL_REPOS` is on.
2. **Is it there?** `resolve(strict=True)`, so an unscanned source is a 404
   rather than an invitation to fetch one.
3. **Is it repo territory?** A clone dir is by construction; a local path has to
   sit in a git working tree, tested by the `.git` marker on it or an ancestor.
   Stats, not `git rev-parse`: this runs per file, and a city asks for hundreds
   at once. It exists so a read can reach no further than a scan of the same
   path could.
4. **Does the path stay inside?** `git.within` resolves it and refuses anything
   landing outside the root, `..` and absolute paths included.

What a client sees, covered by `test_server_file.py` (the routes) and
`git/test_source.py` (the resolution rules behind them):

| request                                        | answer                                             |
| ---------------------------------------------- | -------------------------------------------------- |
| a file in a cloned repo                        | `200`                                              |
| a path that repo doesn't have                  | `404 not found`                                    |
| `../../../etc/passwd`, or an absolute path     | `403 path is outside the repo`                     |
| a source never cloned here                     | `404 source is not on disk: scan it first`         |
| the right URL with the wrong branch            | `404` — the clone dir keys on the branch as passed |
| a local path, hosted (`ALLOW_LOCAL_REPOS` off) | `403 local repositories are disabled`              |
| a local path that isn't in a git working tree  | `404 path is not inside a git working tree`        |
| a `src` that is neither a path nor a URL       | `400`                                              |

Resolving per request rather than remembering which roots were scanned is what
makes a read survive a restart: the browser holds a manifest for as long as its
tab is open, and the process that produced it may be long gone. It also keeps
absolute server paths off the wire entirely.

Media is returned with an explicit `Content-Encoding: identity` so the app-wide
GZipMiddleware skips it. Re-deflating already-compressed bytes costs CPU for
about nothing. Everything else is coerced to `text/plain` so the preview pane
renders it as code.

One request per file, including the hundreds a media-heavy city asks for at
once. These were once batched into JSON POSTs, because HTTP/1.1 allows six
connections per origin; browsers reach this over HTTP/2, which multiplexes them
on one connection. Batching binary through JSON cost base64 inflation, a
whole-response buffer at both ends, a size cap with a fallback path around it,
and one opaque cache entry for the lot — so every city rebuild refetched every
image rather than revalidating each on its own.

A URL carrying a version (`mtime` or `sha`) names one immutable body and is
served `immutable`; a bare one means "whatever is there now" and must
revalidate. That is what makes per-file requests cheaper than the batch was, not
more expensive.

`/api/fingerprint` is a sibling, not a plural: raw binary bytes never leave the
server, only a generated image of the byte pattern in a file's head.

Content that isn't downloaded yet (a git-lfs pointer, a blob a partial clone
hasn't backfilled) answers `202` with the reason, never `404`. A repo mid-fetch
would otherwise answer a whole page of previews with 404s, and a burst of those
from one client is what gets that client blocked.

## Time travel

`?ref=` reconstructs the manifest as of a commit instead of scanning the working
tree. The ref is resolved to a sha first, because that sha is both the cache key
and the early "bad ref" error.

That path emits no skeleton events. The city is already drawn for the live tree,
so a `manifest-partial` would just flash placeholders over it.
