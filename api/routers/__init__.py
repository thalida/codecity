"""The HTTP surface. Every route codecity serves is in one of these.

    manifest  /api/manifest, /api/manifest/signature, /api/manifest/cached,
              /api/timeline — the two SSE streams and the cheap lookups
    file      /api/file, /api/images, /api/fingerprints — bytes out of a
              scanned root, trust-checked
    commit    /api/commit — one commit's detail
    branches  /api/branches — a remote's branch list, no clone
    meta      /api/health, /api/config, /api/discover
    static    the SPA and its index fallback, mounted last so it owns every
              non-/api path
    sse       not a router: the worker-thread plumbing both streams run on

app.py imports the modules and registers `.router` from each, so there is
nothing to re-export here. Order matters at registration, not here — see
app.create_app.
"""
