# CodeCity

CodeCity visualizes a codebase as an isometric 3D city. Point it at a git repository and it walks the tree, collects file metadata + git history, then opens the city in your browser. Directories become streets, files become buildings; shape and color encode size, line count, language, and how recently the code changed.

## Quick start

Requires: Docker.

```sh
docker run --rm --init \
    -v codecity-cache:/cache \
    -p 8080:8080 \
    ghcr.io/thalida/codecity
```

Then open <http://localhost:8080/> and paste a git URL into the source picker. CodeCity clones it into its cache and renders the city.

Out of the box, CodeCity works with **git URLs only**. To render a local repo, see [Advanced: rendering local directories](#advanced-rendering-local-directories) below.

> Tip: any `*.localhost` subdomain works (e.g. <http://codecity.localhost:8080/>). Use a unique subdomain per project to keep your source-picker recents (browser localStorage) isolated.

Cache lives in the Docker volume `codecity-cache`. To wipe: `docker volume rm codecity-cache`. Port conflict? Use a different host port: `-p 8081:8080`.

## Advanced: rendering local directories

To render a local git repo, mount it into the container at the same absolute path. The source picker will show the host path and resolve correctly inside the container.

**Recommended — mount your code/repos directory only:**

```sh
docker run --rm --init \
    -v "$HOME/Documents/Repos:$HOME/Documents/Repos:ro" \
    -v codecity-cache:/cache \
    -p 8080:8080 \
    ghcr.io/thalida/codecity
```

Replace `$HOME/Documents/Repos` with wherever you keep code. Use multiple `-v` flags to mount multiple directories.

**Full `$HOME` mount — browse anywhere under your home:**

```sh
docker run --rm --init \
    -v "$HOME:$HOME:ro" \
    -v codecity-cache:/cache \
    -p 8080:8080 \
    ghcr.io/thalida/codecity
```

> On macOS, Docker Desktop will show a one-time warning about sharing your home directory. Click OK (or "Don't show again"). Trade-off: the container can read everything under `$HOME`. Bind-mount performance on a huge home dir can be slow.

### Local-directory requirements

CodeCity only renders **git working trees**. Any local path you mount must be inside a git repo (the path itself, or any of its parents, must contain `.git/`). Non-git directories — and bare repos (no working tree) — are rejected with a clear error. If you want to visualize a non-git directory, `git init` it first; or use a git URL to clone into CodeCity's cache.

### Mount syntax caveats

- The trailing `:ro` flag in `-v <src>:<dst>:ro` can be silently dropped if your path contains characters Docker parses ambiguously. If you see unexpected writes or want stricter syntax, use the long form: `--mount type=bind,source=<src>,target=<dst>,readonly`.
- Git worktrees (created with `git worktree add`) have a `.git` *file* pointing at the parent repo's `.git/worktrees/<name>/`. To render a worktree, mount the parent repo too (or mount its `.git` dir alongside) so the in-container git can resolve the link.

## How it works

- **Scan** — Python walks the tree on every `/api/manifest` request, gathering stat + git metadata in memory.
- **Serve** — The container's Python HTTP server (port 8080) computes a fresh manifest per request and streams individual files at `/api/file?path=…` for the in-app preview.
- **Render** — Your browser loads the bundled three.js renderer from the same server. Nothing leaves your machine.

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

## Live updates and hot-reload

The city re-renders **in place** as you edit:

- **Filesystem changes** — when **Updates → Live updates** is on (default), the frontend polls `/api/manifest` on a user-tunable interval (clamped to 1–60 s); when the tree's mtime/size signature changes, new buildings grow in and shifted siblings slide to make room.
- **Config tweaks** — every slider, color, and toggle in the Controls pane is hot-reloadable.

## Requirements

- Docker (Docker Desktop on macOS/Windows; engine + WSL on Windows; docker on Linux)
- A modern browser (Chrome, Safari, Firefox, Edge — anything with WebGL2 support)

## Development

Requires: Docker, just (optional but recommended), python3 (for the worktree-aware `just dev` port helper).

```sh
git clone https://github.com/thalida/codecity.git
cd codecity
just dev                          # http://<worktree-slug>.localhost:<port>/  (Vite HMR + Python API)
just test                         # pytest + vitest in containers (230 + 1940 tests)
just build                        # build the local image
just run                          # run the local image like an end user
```

### Multiple worktrees

`just dev` is worktree-aware. Each worktree:

- Gets a unique compose project name (derived from the worktree dir name), so containers and named volumes don't collide.
- Picks a free host port for Vite on first run, persists to `.local/worktree-ports.json` (gitignored, per-worktree) so the URL is stable across restarts.
- Opens at `http://<worktree-slug>.localhost:<port>/` — the subdomain isolates browser storage per worktree.
- Has its own isolated cache volume (compose-scoped; cold cache per worktree by design).

You can run `just dev` in multiple worktrees simultaneously — each gets a different port automatically and they don't interfere.

### Layout

```text
codecity/
  api/                 # Python HTTP server (scan, cache, clone, serve)
  app/                 # Vite frontend (TypeScript + three.js)
  Dockerfile           # multi-stage build (node:24-bookworm-slim → python:3.13-slim)
  docker-compose.dev.yml      # contributor dev mode (HMR + auto-reload)
  docker-compose.test.yml     # contributor test runners
  pyproject.toml + uv.lock    # python deps + hatch-vcs versioning
  justfile             # build / dev / test / shell / clean
```

## Release

Cut a release from `main`:

```sh
git tag v0.2.0
git push --tags
```

GitHub Actions builds a multi-arch image (linux/amd64 + linux/arm64), pushes to `ghcr.io/thalida/codecity` with all tag aliases (`v0.2.0`, `v0.2`, `v0`, `latest`, `sha-…`), signs with cosign keyless via OIDC, smoke-tests the published image via `/api/health`, and creates a GitHub Release.

To verify image signatures:

```sh
cosign verify \
  --certificate-identity-regexp 'https://github.com/thalida/codecity/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/thalida/codecity:v0.2.0
```

## License

[AGPL-3.0](LICENSE)
