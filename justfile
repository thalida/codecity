# Default: list available recipes.
default:
    @just --list

# ── Local run ────────────────────────────────────────────────────
# Dev mode: Vite HMR + api auto-reload. Worktree-aware.
# Picks a free host port per worktree (persisted to .local/worktree-ports.json),
# uses a worktree-derived compose project name (so containers + volumes don't
# collide), and prints a subdomain URL so browser storage is isolated per
# worktree.
dev:
    @mkdir -p .local
    @python3 -c "import json, socket, pathlib; \
        p = pathlib.Path('.local/worktree-ports.json'); \
        d = json.loads(p.read_text()) if p.exists() else {}; \
        s = socket.socket(); s.bind(('', 0)); d.setdefault('vite', s.getsockname()[1]); s.close(); \
        p.write_text(json.dumps(d))"
    @SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     PORT=$(python3 -c "import json; print(json.load(open('.local/worktree-ports.json'))['vite'])") ; \
     echo "[codecity-dev] http://$SLUG.localhost:$PORT/" ; \
     VITE_HOST_PORT=$PORT \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml up --build

# Prod-like local run: one container, no host mount (default per spec).
# Per the README Quick Start. Add `-v $HOME/path:$HOME/path:ro` to mount
# a local git repo for visualization.
run:
    @SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     echo "[codecity] http://$SLUG.localhost:8080/" ; \
     IMAGE_ID=$(docker build -q \
         --build-arg GIT_SHA=$(git rev-parse HEAD) \
         --build-arg VERSION=0.0.0+g$(git rev-parse --short HEAD) .) ; \
     docker run --rm --init \
         -v codecity-cache:/cache \
         -p 8080:8080 \
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

# ── Cleanup ──────────────────────────────────────────────────────
clean:
    @SLUG=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml down --volumes --rmi local 2>/dev/null || true ; \
     docker compose -f docker-compose.test.yml down --rmi local 2>/dev/null || true
    rm -f .local/worktree-ports.json

clean-cache:
    docker volume rm codecity-cache 2>/dev/null || true
