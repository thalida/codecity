<img src=".github/readme/banner.png" alt="codecity side-on banner: the floating island skyline with the thalida/codecity label" width="100%" />

<div align="center">
  <h1>
    <img src="app/public/gem.svg" alt="" width="32" align="center" /> codecity
  </h1>
  <p><a href="https://codecity.io">codecity.io</a></p>
</div>

**codecity turns any git repo into a 3D city.** It walks the file tree and git history and builds a world: directories become streets, files become buildings, every commit grows a tree, and every author a firefly.

<img src=".github/readme/demo.webp" alt="codecity orbiting its own repo: streets of buildings under a forest of commit trees" width="800" />

## Try it

**Open any public repo at [codecity.io](https://codecity.io).**

To view private and local repos, follow the steps below.

## Run it yourself

You need:

- [Docker](https://docs.docker.com/get-docker/)
  - macOS: Docker Desktop
  - Windows: Docker Desktop, or engine + WSL
  - Linux: `docker`
- A modern browser with WebGL2 (Chrome, Safari, Firefox, Edge)

```sh
docker run --rm --init --pull=always \
    -v codecity-cache:/cache \
    -p 8080:8080 \
    ghcr.io/thalida/codecity
```

1. Open <http://localhost:8080/> to reach the Projects page
2. Paste a repo URL and pick a branch, or open one from Discover
3. Explore your city!

Local folders take one more step, see [Local directories](#local-directories) below.

**Tips**

- The URL is the view. It carries the repo, the branch, the timeline commit and what you have
  selected, so copying it drops someone else exactly where you are, and Back walks you out
- `--pull=always` keeps you on the latest image; drop it to pin to your cached copy
- Wipe the cache: `docker volume rm codecity-cache`
- Port in use? `-p 8081:8080`

## Advanced setup

### Configuration

Everything codecity reads is an env var, passed with `-e`:

| Variable                     | Default             | What it does                                                                                                           |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `CODECITY_ALLOW_LOCAL_REPOS` | off                 | Render local folders. Needs a matching mount, see [Local directories](#local-directories)                              |
| `CODECITY_HOSTED`            | off                 | Marks a public deployment, where a local path can never resolve. Changes the advice shown when a repo can't be reached |
| `CODECITY_FEATURED_REPO`     | none                | The repo the landing renders behind itself, and flags in Discover. Empty means no backdrop                             |
| `CODECITY_DISCOVER`          | on                  | The Discover tab of repos worth rendering. Set `off` to hide it                                                        |
| `CODECITY_DISCOVER_FILE`     | `api/discover.json` | Swap in your own curated list: a JSON array of `{"url", "label"}`                                                      |
| `CODECITY_CACHE_ROOT`        | `/cache`            | Where clones and the manifest cache live                                                                               |
| `CODECITY_CACHE_BUDGET_MB`   | `1024`              | Ceiling for the derived caches, swept oldest-first. Clones aren't counted and aren't swept                             |
| `CODECITY_QUIET`             | off                 | Silence disconnect and scan logs                                                                                       |

Booleans take `1`/`true`/`yes`/`on`.

### Local directories

Local repo support is **disabled by default**. To enable it, set `CODECITY_ALLOW_LOCAL_REPOS=1` _and_ mount the directory read-only into the container at the same absolute path:

```sh
docker run --rm --init --pull=always \
    -e CODECITY_ALLOW_LOCAL_REPOS=1 \
    -v "$HOME/Documents/Repos:$HOME/Documents/Repos:ro" \
    -v codecity-cache:/cache \
    -p 8080:8080 \
    ghcr.io/thalida/codecity
```

- Use multiple `-v` flags to mount more than one directory
- codecity only renders git working trees: `git init` first to render a non-git directory

### `.codecityignore`

For per-project ignores, drop a `.codecityignore` at the scan root, one pattern per line:

```gitignore
# Skip anywhere named "fixtures"
fixtures

# Skip a specific path (relative to scan root)
tests/fixtures/large-repo

# Un-ignore a default skip (! prefix overrides ALWAYS_SKIP)
!package-lock.json
```

#### Skipped by default

Always ignored, even when tracked (`!` un-ignores them):

- VCS: `.git`, `.hg`, `.svn`
- JS: `node_modules`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `deno.lock`
- Python: `.venv`, `venv`, `env`, `__pycache__`, `poetry.lock`, `uv.lock`, `Pipfile.lock`
- Rust: `target`, `.cargo`, `Cargo.lock`
- Go: `Gopkg.lock`, `go.sum`
- PHP: `composer.lock`
- Ruby: `Gemfile.lock`
- Elixir: `mix.lock`
- CocoaPods: `Podfile.lock`
- Nix: `flake.lock`
- Framework caches: `.next`, `.nuxt`, `.svelte-kit`
- Test / coverage: `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox`, `.coverage`, `htmlcov`
- IDE / OS: `.idea`, `.vscode`, `.DS_Store`
- Generated artifacts: `sbom.json` (CycloneDX / SPDX software bill of materials)
- Vendored single-file amalgamations: `sqlite3.c`, `miniz.c`, `lua.c` (one giant `.c` blob inlining a whole library: 100k+ lines that would otherwise render as a single skyscraper distorting every height-based visual)

## Reading the city

<img src=".github/readme/overview.png" alt="A large repo rendered with the gem, streets, buildings, and fireflies all visible at once" width="800" />

Just about every aspect of the rendering is tunable in the Settings pane, opened via the gear in the left sidebar.

### Buildings: one per file

<img src=".github/readme/buildings.png" alt="Skyscrapers close-up showing lit windows, file-extension hues, and the street label below" width="600" />

- **Height**: line count (sqrt-interp across the floor range)
- **Width & depth**: byte size (log-interp, square footprint)
- **Hue**: file extension
- **Saturation**: time since last touched (recent → vivid)
- **Lightness**: time since last touched (recent → bright)
- **Fade clock**: real time, so a repo nobody has touched in a year reads faded throughout, and today's edit brightens the one building you changed
- **Roof border**: the color the file would have if you touched it today, so the gap between the border and the faded walls is how far it has aged
- **Windows**: lit-pane density, plus a glow that tracks how recently the file was created (newer files glow brighter)
- **Aging**: older files get grime streaks
- **Media files** (images, video) render an ad-panel face on the front above the door
- **Binary files** (databases, `.wasm`, `.so`, fonts, audio) become windowless data blocks sized by byte count, faced with a fingerprint of their own bytes — or, for fonts and audio, a letter set in the font and the waveform itself

### Streets: one per directory

<img src=".github/readme/streets.png" alt="Top-down view of the street grid with directory labels painted on the asphalt" width="600" />

- **Width tier**: descendant count (step function)
- **Length**: packed siblings + spacing
- **Label**: directory name painted on the asphalt

### Trees: one per commit

<img src=".github/readme/trees.png" alt="A repo with thousands of commits rendered as a dense forest overtaking the city" width="600" />

- **Placement**: oldest commit closest to the gem, newest at the edges
- **Height**: commit age (older = taller), on the same clock the buildings fade by
- **Canopy width**: files changed in that commit
- **Color**: commits-per-day (solo-day vs busy-day color blend)

### Fireflies: one orb per author on each commit

<img src=".github/readme/fireflies.png" alt="Close-up of low-poly trees with white firefly orbs drifting between them" width="600" />

- **Color**: per author. Each committer gets their own hue
- **Scale**: that author's total commit count
- **Co-authored commits**: `Co-authored-by:` trailers parsed out of the commit message. Each distinct contributor on a commit gets their own firefly orbiting that tree, in their own color

### Gem: the root beacon

<img src=".github/readme/gem.png" alt="The glowing pink gem floating above the root street, lighting the buildings around it" width="600" />

- **Root marker**: floats above the root street
- **Click**: clears the selection and resets the view

## Timeline

<img src=".github/readme/timeline.png" alt="An older commit rebuilt: a part-built city with deleted files crossed out where they stood" width="800" />

**Scrub the whole history and watch the city grow.** The scene toggle flips from Live to Timeline, and a dated slider spans the repo, a tick per commit. Drag it and the city rebuilds at that commit.

**Deleted files** keep their plot and get crossed out, so a folder that's since been emptied still shows what it used to hold. Set it in the World tab under Timeline.

## How it works

1. **Clone or read:** Remote repos clone into a local cache (current tree only); local folders are read in place.
2. **Scan:** codecity reads only git-tracked files (`git ls-files`), honoring `.codecityignore` and the default skips, and records each file's created and last-modified dates plus each commit's files, authors, and date.
3. **Stream:** Packed into one manifest and streamed to the browser as it's computed: a skeleton city renders first as a placeholder, then fills in with the full scan.
4. **Layout:** An off-main-thread pass packs the streets so nothing overlaps: directories become streets, files line up as buildings, subdirectories branch off at right angles.
5. **Build:** Each building is sized from its file (height = lines, footprint = bytes), one tree per commit (oldest nearest the gem), a firefly per author.
6. **Render:** Drawn with three.js (WebGL).

## Development

### Setup

You need:

- [Docker](https://docs.docker.com/get-docker/)
- [just](https://github.com/casey/just#installation)
- [Node](https://nodejs.org/) (`just setup` installs the repo's packages with it)
- [python3](https://www.python.org/downloads/)
- [uv](https://docs.astral.sh/uv/) (for `just fmt` and `just gen-types`)

```sh
git clone https://github.com/thalida/codecity.git
cd codecity
just setup   # one-time: pre-push hooks, npm packages, .env.local
```

Regenerating the README's screenshots and demo also needs `ffmpeg` and `webp`
(`brew install ffmpeg webp`); nothing else does.

The pre-push hook runs the full lint + tests before pushing; bypass with `git push --no-verify` (Docker must be running).

### Commands

| Command          | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| `just setup`     | one-time: pre-push hooks, npm packages, `.env.local`            |
| `just dev`       | Vite HMR + API auto-reload at `http://<slug>.localhost:<port>/` |
| `just url`       | print this worktree's dev URL (`open $(just url)`)              |
| `just test`      | pytest + vitest in containers                                   |
| `just lint`      | ruff, pyright, eslint, prettier, and typecheck                  |
| `just gen-types` | regenerate the frontend wire types from the OpenAPI schema      |
| `just clean`     | tear down this worktree's containers and volumes                |

`just --list` has the rest: per-suite tests, formatting, image builds, README
assets, release and deploy.

### Your settings

Two env files, split by whether everyone shares the values:

- **`.env`** is tracked. Version pins and the deploy target, identical for everyone.
- **`.env.local`** is yours and gitignored, seeded from `.env.local.example` by `just setup`. Put your mount and your flags there and `just dev` picks them up:

```sh
CODECITY_MOUNT=~/Documents/Repos     # comma-separated for several
CODECITY_FEATURED_REPO=https://github.com/thalida/codecity
```

`just dev` and `just run` also take docker's `-v` and `-e` for a one-off, which
beat the file for that run:

```sh
just dev -v ~/Documents/Repos/myproj -e CODECITY_DISCOVER=off
```

A mount, from either place, turns on `CODECITY_ALLOW_LOCAL_REPOS`; without one,
codecity is git-URL-only. Only the `CODECITY_*` vars reach the container, so the
Forgejo credentials in the same file stay on your machine.

`.local/` is generated state (worktree ports, the compose override). Nothing in
there is hand-edited and it's always safe to delete.

### Worktrees

```sh
just worktree-setup fix/my-branch      # the branch has to exist first
just worktree-teardown fix/my-branch   # once its PR is merged
```

- Each worktree gets its own `<slug>.localhost` URL, so source-picker recents stay isolated per project in localstorage
- `.env.local` and `.claude/settings.json` are gitignored, so `worktree-setup` copies yours across
- `worktree-teardown` takes the docker stack and its volumes with it

## Release

```sh
just release v0.2.0
```

This ships to production. The tag is the trigger for everything below.

`just release`:

- verifies you're on a clean `main` in sync with origin
- creates an annotated tag and pushes it

Pushing the tag triggers GitHub Actions, which:

- builds a multi-arch image (linux/amd64 + linux/arm64)
- pushes to `ghcr.io/thalida/codecity` with all tag aliases
- signs with cosign (keyless via OIDC)
- smoke-tests via `/api/health`
- creates a GitHub Release
- deploys production, see [Deploy](#deploy) below

### Deploy

A release deploys itself: once the image is published, the release workflow
dispatches `deploy.yml` on Forgejo. It skips itself when the secrets below
aren't set.

**One-time setup**

1. Create a Forgejo token under **Settings → Applications**, scoped `repository → Read and Write`, everything else `No access`
2. Fill in `.env.local` (gitignored, seeded by `just setup`) with `FORGEJO_HOST`, `FORGEJO_REPO`, `FORGEJO_TOKEN`
3. Add those same three under **Settings → Secrets and variables → Actions → Secrets**

**Redeploying without a release**

```sh
just deploy
```

### Verify signatures

```sh
cosign verify \
  --certificate-identity-regexp 'https://github.com/thalida/codecity/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/thalida/codecity:v0.2.0
```

## License

[AGPL-3.0](LICENSE)
