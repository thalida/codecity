# CodeCity

CodeCity visualizes a codebase as an isometric 3D city. Point it at a directory and it walks the tree, collects file metadata + git history, then opens the city in your default browser. Directories become streets, files become buildings; shape and color encode size, line count, language, and how recently the code changed.

## Quick start

```sh
uv tool install codecity            # or: pipx install codecity
codecity                            # opens the source picker in your browser
```

Your default browser opens at `http://<repo>.localhost:<port>/` to a source picker — point it at any local directory, or paste a git URL to clone into `~/.cache/codecity/clones/<hash>/` and render that. The picker remembers recent sources in localStorage. Pan with right-click drag, orbit with left-click drag, zoom with the scroll wheel. Click a building to inspect its file in the right sidebar. The left sidebar gives you a tree view, settings, and shortcut help. Ctrl-C in the terminal to stop the server.

The selected source lives in the page URL (`?src=…`, with optional `&branch=…`), so you can switch projects without restarting the server by editing the address bar.

## How it works

- **Scan** — Python walks the tree on every `/api/manifest` request, gathering stat + git metadata in memory.
- **Serve** — A local HTTP server (`127.0.0.1:<random-port>`) computes a fresh manifest per request and streams individual files at `/api/file?path=…` for the in-app preview.
- **Render** — Your browser loads the bundled three.js renderer from the same server. Nothing leaves your machine.

## CLI

```sh
codecity                 # prod HTTP server, opens the source picker in your browser
codecity --dev           # Vite dev server + Python API (frontend HMR)
codecity --port N        # override prod HTTP port (or Vite port in --dev)
codecity --api-port N    # override Python API port (--dev only)

codecity --help
codecity --version
```

Both modes auto-select free ports (avoiding ports held by sibling worktrees), persist them to `.local/worktree-ports.json` so the same URLs survive restarts, and open the browser at `http://<repo>.localhost:<port>/`. Pass `--dev` to run via Vite (frontend HMR) instead of the committed static build. Source selection (local path or git URL) happens in the browser UI.

## Live updates and hot-reload

The city re-renders **in place** as you edit:

- **Filesystem changes** — when **Updates → Live updates** is on (default), the frontend polls `/api/manifest` on a user-tunable interval (clamped to 1–60 s); when the tree's mtime/size signature changes, new buildings grow in and shifted siblings slide to make room. The camera position and your current selection survive the rebuild.
- **Config tweaks** — every slider, color, and toggle in the Controls pane is hot-reloadable. Hot-reloadable configs (sidewalk colors, gem appearance, path-line opacity, …) update materials live; rebuild-required configs (building dimensions, layout gaps, palette mappings, …) trigger a debounced in-place re-layout. There's no "Rebuild" button to press — every change takes effect immediately.

Scan filtering — including/excluding files and toggling `.gitignore` honoring — is configured in the in-app Controls pane, not via CLI flags. Git timestamps are preferred over filesystem timestamps when the scanned directory is a git repository.

## Building visual encoding

Each file becomes a building. Visual properties map directly to data:

| Property   | Source                | Meaning                                                            |
| ---------- | --------------------- | ------------------------------------------------------------------ |
| Height     | Line count            | Taller = more lines of code                                        |
| Width      | File size (bytes)     | Wider = larger file on disk                                        |
| Depth      | Blend of height/width | `lerp(width, height, 0.5)`                                         |
| Hue        | File extension        | Language family (blue = JS/TS, orange = Python, green = CSS, etc.) |
| Saturation | File age (created)    | Vivid = newer file, faded = older file                             |
| Lightness  | Last modified date    | Bright = recently changed, dim = long untouched                    |

Tweak any of these live from the in-app Controls pane (left sidebar → gear icon).

## Requirements

- Python ≥ 3.11
- A modern browser (Chrome, Safari, Firefox, Edge — anything with WebGL2 support)
- Git (optional — only used when the scanned dir is a repo)
- For `--dev` mode: Node.js + npm

## Development

Two trees, cleanly separated: Python lives at the repo root, the frontend lives in `web/`.

```sh
git clone https://github.com/thalida/codecity.git
cd codecity
just setup                       # uv sync + npm install
( cd web && npm run build )      # → codecity/static/
uv run codecity                  # smoke test (pick this repo in the source picker)
```

Hot-reload loop while editing the frontend:

```sh
just dev           # Vite + Python API on auto-selected free ports, opens browser, Ctrl-C to stop
```

`just dev` picks free ports automatically (avoiding ports held by sibling worktrees), saves them to `.local/worktree-ports.json`, and opens `http://<repo>.localhost:<port>/` so the same URL survives restarts. Run `codecity` (no flag) the same way for the prod static build — it also auto-selects + persists its own port.

### Tests

```sh
( cd web && npm test )           # vitest
uv run pytest                    # pytest  (run from repo root)
```

`pytest` includes a **drift check** (`codecity/tests/test_drift.py`) that does a fresh `npm run build` into a tempdir and fails if the result differs from the committed `codecity/static/`. That guarantees the bundled frontend on PyPI matches `web/` source. The check skips automatically when `npm` or `web/node_modules/` are missing.

### Layout

```text
codecity/                # python package
  cli.py                 # argparse + dispatcher
  scan.py                # filesystem + git walker
  server.py              # stdlib http server + /api routes
  static/                # vite build output (committed)
  tests/                 # pytest
pyproject.toml, uv.lock  # python tooling

web/                     # frontend, fully self-contained
  package.json, vite.config.js, vitest.config.js
  index.html, main.js, styles.css
  components/, scene/, config/
  tests/                 # vitest
```

## Release

Cut a release from `main` after the drift test is green:

```sh
# 1. Rebuild the frontend if web/ has changed since the last commit.
( cd web && npm run build )
git add codecity/static
git commit -m "chore: rebuild frontend"   # only if anything changed

# 2. Bump the version in BOTH places (they must match):
#    pyproject.toml     →  version = "X.Y.Z"
#    codecity/__init__.py →  __version__ = "X.Y.Z"
git commit -am "chore: release vX.Y.Z"
git tag vX.Y.Z

# 3. Build sdist + wheel into dist/.
uv build

# 4. Publish to PyPI. One-time setup: export UV_PUBLISH_TOKEN=<pypi-token>.
uv publish

# 5. Push the release commit + tag.
git push && git push --tags
```

Why two version strings? `pyproject.toml` is the source of truth for `pip` / `uv` install resolution; `codecity/__init__.py.__version__` is what `codecity --version` prints at runtime. Keeping them in lockstep is a manual contract — drift here would surface as the CLI reporting a stale version after install.

## License

[AGPL-3.0](LICENSE)
