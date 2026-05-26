# Default: list available recipes.
default:
    @just --list

# ── Local run ────────────────────────────────────────────────────
# Dev mode: Vite HMR + api auto-reload. Worktree-aware.
# Optional positional `mount` arg: a path to mount read-only into the api
# container at the same absolute path (same UX as `just run`). Generates
# a compose override at .local/dev-mount.override.yml (gitignored) so the
# extra mount can be layered onto the base dev compose without editing it.
# Picks a free host port per worktree (persisted to .local/worktree-ports.json
# under key 'vite'), uses a worktree-derived compose project name (so containers
# + volumes don't collide), and prints a subdomain URL so browser storage is
# isolated per worktree. Auto-re-picks if the saved port becomes occupied.
dev mount='':
    @PORT=$(python3 bin/pick-port.py vite) ; \
     SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     COMPOSE_ARGS="-f docker-compose.dev.yml" ; \
     if [ -n "{{mount}}" ]; then \
         ABS=$(realpath "{{mount}}") || exit 1 ; \
         mkdir -p .local ; \
         printf 'services:\n  api:\n    volumes:\n      - "%s:%s:ro"\n' "$ABS" "$ABS" > .local/dev-mount.override.yml ; \
         COMPOSE_ARGS="$COMPOSE_ARGS -f .local/dev-mount.override.yml" ; \
         echo "[codecity-dev] mounted $ABS" ; \
     fi ; \
     echo "[codecity-dev] http://$SLUG.localhost:$PORT/" ; \
     VITE_HOST_PORT=$PORT \
     docker compose -p codecity-$SLUG $COMPOSE_ARGS up --build

# Prod-like local run: one container, mirrors the README Quick Start.
# Optional positional `mount` arg: a path to mount read-only at the same
# absolute path inside the container, so codecity can render that local
# git repo. Without it, the container has no host filesystem access and
# can only render git URLs.
# Picks a free host port per worktree (persisted to .local/worktree-ports.json
# under key 'run') so bookmarked URLs survive restarts AND concurrent worktrees
# don't fight over port 8080. Auto-re-picks if the saved port becomes occupied.
run mount='':
    @PORT=$(python3 bin/pick-port.py run) ; \
     SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     MOUNT_ARG="" ; \
     if [ -n "{{mount}}" ]; then \
         ABS=$(realpath "{{mount}}") || exit 1 ; \
         MOUNT_ARG="-v $ABS:$ABS:ro" ; \
         echo "[codecity] mounted $ABS" ; \
     fi ; \
     echo "[codecity] http://$SLUG.localhost:$PORT/" ; \
     IMAGE_ID=$(docker build -q \
         --build-arg GIT_SHA=$(git rev-parse HEAD) \
         --build-arg VERSION=0.0.0+g$(git rev-parse --short HEAD) .) ; \
     docker run --rm --init \
         -v codecity-cache:/cache \
         $MOUNT_ARG \
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
