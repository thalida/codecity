# CodeCity

CodeCity visualizes a codebase as an isometric 3D city. Point it at a directory and it walks the tree, collects file metadata + git history, then opens the city in your default browser. Directories become streets, files become buildings; shape and color encode size, line count, language, and how recently the code changed.

## Quick start

```sh
uv tool install codecity            # or: pipx install codecity
codecity /path/to/your/repo
```

Your default browser opens to a local URL with the city. Pan with right-click drag, orbit with left-click drag, zoom with the scroll wheel. Click a building to inspect its file in the right sidebar. The left sidebar gives you a tree view, settings, and shortcut help. Ctrl-C in the terminal to stop the server.

## How it works

- **Scan** — Python walks the tree once, gathers stat + git metadata in memory.
- **Serve** — A local HTTP server (`127.0.0.1:<random-port>`) hands the manifest to the frontend at `/api/manifest` and streams individual files at `/api/file?path=…` for the in-app preview.
- **Render** — Your browser loads the bundled three.js renderer from the same server. Nothing leaves your machine.

## CLI

```sh
codecity PATH                       # shorthand for: codecity serve PATH
codecity serve PATH [--dev] [--port N] [--no-window]
codecity scan  PATH [--output FILE] # emit the manifest as JSON

codecity --help
codecity --version
```

Pass `--dev` to run via Vite (frontend HMR) instead of the committed static build.

Every subcommand accepts the same scan flags:

| Flag             | Default   | Meaning                                  |
| ---------------- | --------- | ---------------------------------------- |
| `--depth N`      | unlimited | Max directory depth                      |
| `--include PAT`  | —         | Only filenames matching this glob        |
| `--exclude PAT`  | —         | Skip filenames matching this glob        |
| `--no-gitignore` | off       | Include files even if `.gitignored`      |

Git timestamps are preferred over filesystem timestamps when the scanned directory is a git repository.

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
git clone https://github.com/thalida/codecity-ai.git
cd codecity-ai
uv sync                          # python deps  (run from repo root)
( cd web && npm install )        # frontend deps
( cd web && npm run build )      # → codecity/static/
uv run codecity .                # smoke test against this repo
```

Hot-reload loop while editing the frontend:

```sh
uv run codecity --dev .
```

That spawns Vite on `:5173` and the Python API on `:8765`, opens your browser at the Vite URL (which proxies `/api/*` back to Python), and tears both down on Ctrl-C.

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
