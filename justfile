# Default: list available recipes.
default:
    @just --list

# ── Local run ────────────────────────────────────────────────────
# Dev mode: Vite HMR + api auto-reload. Worktree-aware.
# Picks a free host port per worktree (persisted to .local/worktree-ports.json
# under key 'vite'), uses a worktree-derived compose project name (so containers
# + volumes don't collide), and prints a subdomain URL so browser storage is
# isolated per worktree. Auto-re-picks if the saved port becomes occupied.
dev:
    @PORT=$(python3 bin/pick-port.py vite) ; \
     SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     echo "[codecity-dev] http://$SLUG.localhost:$PORT/" ; \
     VITE_HOST_PORT=$PORT \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml up --build

# Prod-like local run: one container, no host mount (default per spec).
# Per the README Quick Start. Add `-v $HOME/path:$HOME/path:ro` to mount
# a local git repo for visualization.
# Picks a free host port per worktree (persisted to .local/worktree-ports.json
# under key 'run') so bookmarked URLs survive restarts AND concurrent worktrees
# don't fight over port 8080. Auto-re-picks if the saved port becomes occupied.
run:
    @PORT=$(python3 bin/pick-port.py run) ; \
     SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     echo "[codecity] http://$SLUG.localhost:$PORT/" ; \
     IMAGE_ID=$(docker build -q \
         --build-arg GIT_SHA=$(git rev-parse HEAD) \
         --build-arg VERSION=0.0.0+g$(git rev-parse --short HEAD) .) ; \
     docker run --rm --init \
         -v codecity-cache:/cache \
         -p $PORT:8080 \
         $IMAGE_ID

# Shell into the api container in dev mode.
shell:
    @SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml run --rm api sh

# ── Tests ────────────────────────────────────────────────────────
test: test-api test-app

test-api:
    docker compose -f docker-compose.test.yml run --rm pytest

test-app:
    docker compose -f docker-compose.test.yml run --rm vitest

# ── Lint / typecheck ─────────────────────────────────────────────
# Reads NPM_VERSION from the repo-root .env file (canonical source for
# compose + just). Dockerfile ARG default and ci.yml `env:` block mirror it.
lint:
    @NPM_VERSION=$(grep '^NPM_VERSION=' .env | cut -d= -f2) ; \
     docker compose -f docker-compose.test.yml run --rm vitest \
         sh -c "npm install -g npm@$$NPM_VERSION && npm ci && npm run lint && npm run typecheck && npm run format:check"

# ── Build ────────────────────────────────────────────────────────
build:
    docker build \
        --build-arg GIT_SHA=$(git rev-parse HEAD) \
        --build-arg VERSION=0.0.0+g$(git rev-parse --short HEAD) \
        -t codecity:local .

build-multiarch:
    docker buildx build --platform linux/amd64,linux/arm64 \
        --build-arg GIT_SHA=$(git rev-parse HEAD) \
        --build-arg VERSION=0.0.0+g$(git rev-parse --short HEAD) \
        -t codecity:local .

# ── Git hooks ────────────────────────────────────────────────────
# Install repo-local git hooks. Run once after cloning.
# `core.hooksPath` is per-clone (not committed), so this bootstrap is required.
install-hooks:
    git config core.hooksPath bin/git-hooks
    @echo "[just] git core.hooksPath set to bin/git-hooks/"

# ── Cleanup ──────────────────────────────────────────────────────
clean:
    @SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml down --volumes --rmi local 2>/dev/null || true ; \
     docker compose -f docker-compose.test.yml down --rmi local 2>/dev/null || true
    rm -f .local/worktree-ports.json

clean-cache:
    docker volume rm codecity-cache 2>/dev/null || true
