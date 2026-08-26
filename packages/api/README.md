# codecity — API

The Python half of [codecity](https://github.com/thalida/codecity): a FastAPI
service that walks a repo and serves it as a manifest, plus the built frontend
it ships alongside.

```sh
pip install codecity
codecity --port 8080 /path/to/your/repo
```

Everything the app can show comes from this service: the file tree and its
stats, the SSE scan stream, file contents, per-commit timelines, and branch
discovery. The repo README has the screenshots, the Docker quick start and the
configuration table.

Layered, and imports only ever point down: `routers/` → `scan/` → `git/` and
`cache/` → `models/`, `core/`, `utils/`. `git/`, `scan/`, `routers/` and
`models/` carry a README each.

AGPL-3.0.
