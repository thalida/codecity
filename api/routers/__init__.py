"""The HTTP surface. Every route codecity serves is in one of these.

    manifest  /api/manifest (SSE), plus the cheap /signature and /cached
              lookups over the same source
    timeline  /api/timeline (SSE) — the commit-scrub bundle
    file      /api/file, /api/fingerprint — bytes out of a scanned root,
              trust-checked, one request per file
    commit    /api/commit — one commit's detail
    branches  /api/branches — a remote's branch list, no clone
    meta      /api/health, /api/config, /api/discover
    static    the SPA and its index fallback, mounted last so it owns every
              non-/api path
    sse       not a router: the event shape and worker plumbing both share

app.py imports the modules and registers `.router` from each, so there is
nothing to re-export here. Order matters at registration, not here — see
app.create_app.
"""
