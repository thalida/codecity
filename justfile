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
# under key 'vite'), uses a branch-derived compose project name (so containers
# + volumes don't collide across branches/worktrees), and prints a subdomain
# URL so browser storage is isolated per branch. Falls back to the directory
# basename for detached HEAD. Auto-re-picks if the saved port becomes occupied.
dev mount='': install-hooks setup
    @PORT=$(python3 bin/pick-port.py vite) ; \
     SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     COMPOSE_ARGS="-f docker-compose.dev.yml" ; \
     if [ -n "{{mount}}" ]; then \
         ABS=$(realpath "{{mount}}") || exit 1 ; \
         mkdir -p .local ; \
         printf 'services:\n  api:\n    volumes:\n      - "%s:%s:ro"\n    environment:\n      - CODECITY_ALLOW_LOCAL_REPOS=1\n' "$ABS" "$ABS" > .local/dev-mount.override.yml ; \
         COMPOSE_ARGS="$COMPOSE_ARGS -f .local/dev-mount.override.yml" ; \
         echo "[codecity-dev] mounted $ABS (local repos enabled)" ; \
     fi ; \
     echo "[codecity-dev] http://$SLUG.localhost:$PORT/" ; \
     VITE_HOST_PORT=$PORT \
     docker compose -p codecity-$SLUG $COMPOSE_ARGS up --build

# Print this worktree's dev-server URL (same SLUG + port `just dev` binds).
# Reserves the vite port if `just dev` hasn't run yet. Handy: `open $(just url)`.
url:
    @PORT=$(python3 bin/pick-port.py vite) ; \
     SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     echo "http://$SLUG.localhost:$PORT/"

# Prod-like local run: one container, mirrors the README Quick Start.
# Optional positional `mount` arg: a path to mount read-only at the same
# absolute path inside the container, so codecity can render that local
# git repo. Without it, the container has no host filesystem access and
# can only render git URLs.
# Picks a free host port per worktree (persisted to .local/worktree-ports.json
# under key 'run') so bookmarked URLs survive restarts AND concurrent worktrees
# don't fight over port 8080. Subdomain URL is branch-derived (falls back to
# directory basename on detached HEAD). Auto-re-picks if the saved port becomes
# occupied.
run mount='':
    @PORT=$(python3 bin/pick-port.py run) ; \
     SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     MOUNT_ARG="" ; \
     LOCAL_ENV_ARG="" ; \
     if [ -n "{{mount}}" ]; then \
         ABS=$(realpath "{{mount}}") || exit 1 ; \
         MOUNT_ARG="-v $ABS:$ABS:ro" ; \
         LOCAL_ENV_ARG="-e CODECITY_ALLOW_LOCAL_REPOS=1" ; \
         echo "[codecity] mounted $ABS (local repos enabled)" ; \
     fi ; \
     echo "[codecity] http://$SLUG.localhost:$PORT/" ; \
     IMAGE_ID=$(docker build -q \
         --build-arg GIT_SHA=$(git rev-parse HEAD) \
         --build-arg VERSION=0.0.0+g$(git rev-parse --short HEAD) .) ; \
     docker run --rm --init \
         -v codecity-cache:/cache \
         $MOUNT_ARG \
         $LOCAL_ENV_ARG \
         -p $PORT:8080 \
         $IMAGE_ID

# Shell into the api container in dev mode.
shell:
    @SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml run --rm api sh

# Recover from a corrupt dev app container (symptom: `sh: 1: npm: not found`
# on `just dev` startup). Docker Desktop can leave the app container in a
# state where the entrypoint shell can't see /usr/local/bin/npm despite the
# image being intact — recreating the container fresh restores the PATH.
# Removes just the app container (api + cache volume are preserved) and
# re-runs dev. Accepts the same optional `mount` arg as `dev`.
reset-dev mount='':
    @SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml rm -fs app
    @just dev "{{mount}}"

# ── Tests ────────────────────────────────────────────────────────
test: test-api test-app

test-api:
    docker compose -f docker-compose.test.yml run --rm pytest

test-app:
    docker compose -f docker-compose.test.yml run --rm vitest

# ── Format / lint / typecheck ────────────────────────────────────
# Apply the Python formatter (ruff = the prettier of Python) in place. Local
# uv run (like `gen-types`) so the reformatted files stay owned by you, not the
# container's root.
fmt:
    uv run ruff format api scripts

# Check Python formatting (ruff) — the equivalent of the frontend format:check.
fmt-check:
    docker compose -f docker-compose.test.yml run --rm ruff

# Reads NPM_VERSION from the repo-root .env file (canonical source for
# compose + just). Dockerfile ARG default and ci.yml `env:` block mirror it.
lint: fmt-check
    @NPM_VERSION=$(grep '^NPM_VERSION=' .env | cut -d= -f2) ; \
     docker compose -f docker-compose.test.yml run --rm vitest \
         sh -c "npm install -g npm@$NPM_VERSION && npm ci && npm run lint && npm run typecheck && npm run format:check"

# ── Codegen ──────────────────────────────────────────────────────
# Regenerate app/src/types/manifest.generated.ts from the live OpenAPI schema.
# Single source of truth: api/models/*.py -> OpenAPI -> TS. Run after changing
# any wire model. The drift guard (manifest.contract.ts) fails typecheck if the
# hand-written types in manifest.ts fall out of sync with this generated file.
gen-types:
    @mkdir -p .local
    @uv run python scripts/gen_openapi.py > .local/openapi.json
    @cd app && npx openapi-typescript ../.local/openapi.json -o src/types/manifest.generated.ts
    @echo "[codecity] regenerated app/src/types/manifest.generated.ts"

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

# ── Screenshots ──────────────────────────────────────────────────
# Regenerate the README screenshots in .github/readme/ from a headless capture
# of codecity rendering its own repo (github.com/thalida/codecity), via the
# debug-gated ?shot= capture harness (app/src/city/capture). Needs `just dev`
# running in another terminal; reads its URL from `just url`. Installs the
# Playwright Chromium build on first run. The animated demo.mp4 has its own
# recipe (`just demo-video`). Pass shot names to redo only those:
# `just screenshots fireflies trees`.
screenshots *shots='':
    @URL=$(just url) ; \
     echo "[codecity] capturing README screenshots from $URL" ; \
     cd app && npx playwright install chromium && \
     CODECITY_URL="$URL" node scripts/screenshots.mjs {{shots}}

# Regenerate the animated .github/readme/demo.mp4: a headless orbit of codecity
# rendering its own repo, recorded with Playwright and encoded to a small h264
# mp4 with ffmpeg (required: brew install ffmpeg). Needs `just dev` running.
demo-video:
    @URL=$(just url) ; \
     echo "[codecity] recording demo.mp4 from $URL" ; \
     cd app && npx playwright install chromium && \
     CODECITY_URL="$URL" node scripts/demo-video.mjs

# ── Onboarding ───────────────────────────────────────────────────
# One-shot bootstrap for a fresh clone or new worktree: installs app
# node_modules (so local vitest / IDE intellisense work — runtime
# itself uses Docker via `just dev`) and the per-clone git hooks.
setup: install-hooks
    cd app && npm install
    @echo "[just] setup complete — try 'just dev'"

# ── Git hooks ────────────────────────────────────────────────────
# Install repo-local git hooks. Run once after cloning.
# `core.hooksPath` is per-clone (not committed), so this bootstrap is required.
install-hooks:
    @CURRENT=$(git config --get core.hooksPath || echo "") ; \
     if [ "$CURRENT" != "bin/git-hooks" ]; then \
         git config core.hooksPath bin/git-hooks ; \
         echo "[just] git core.hooksPath set to bin/git-hooks/" ; \
     fi

# ── Release ──────────────────────────────────────────────────────
# Tag + push a release. Pushing a `v*` tag triggers .github/workflows/release.yml
# which builds the multi-arch image, signs it, smoke-tests, and creates the
# GitHub Release. VERSION must look like v1.2.3 or v1.2.3-alpha-4 / v1.2.3-rc.1.
# Refuses to tag unless: on main, working tree clean, in sync with origin/main,
# and the tag doesn't already exist on origin. If the local tag already exists
# at HEAD (resumable state from a prior push failure — e.g. pre-push hook
# failed after `git tag -a` succeeded), pushes it without re-tagging. If push
# fails after this run created the tag, the local tag is rolled back so the
# recipe can be retried cleanly.
release VERSION:
    @set -e ; \
     VERSION="{{VERSION}}" ; \
     if ! printf '%s' "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-.+)?$'; then \
         echo "[just] error: VERSION must match v<major>.<minor>.<patch>[-suffix] (e.g. v0.1.0 or v0.0.0-alpha-3)" >&2 ; exit 1 ; \
     fi ; \
     BRANCH=$(git rev-parse --abbrev-ref HEAD) ; \
     if [ "$BRANCH" != "main" ]; then \
         echo "[just] error: releases must be tagged from main (currently on $BRANCH)" >&2 ; exit 1 ; \
     fi ; \
     if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status --porcelain)" ]; then \
         echo "[just] error: working tree is dirty; commit or stash before releasing" >&2 ; exit 1 ; \
     fi ; \
     git fetch --quiet origin main ; \
     LOCAL=$(git rev-parse main) ; \
     REMOTE=$(git rev-parse origin/main) ; \
     if [ "$LOCAL" != "$REMOTE" ]; then \
         echo "[just] error: local main ($LOCAL) is not in sync with origin/main ($REMOTE); pull/push first" >&2 ; exit 1 ; \
     fi ; \
     if git ls-remote --exit-code --tags origin "refs/tags/$VERSION" >/dev/null 2>&1; then \
         echo "[just] error: tag $VERSION already exists on origin" >&2 ; exit 1 ; \
     fi ; \
     CREATED_TAG=no ; \
     if git rev-parse --verify --quiet "refs/tags/$VERSION" >/dev/null; then \
         TAG_COMMIT=$(git rev-parse "refs/tags/$VERSION^{commit}") ; \
         if [ "$TAG_COMMIT" != "$LOCAL" ]; then \
             echo "[just] error: local tag $VERSION points to $TAG_COMMIT, not current main ($LOCAL); 'git tag -d $VERSION' and retry" >&2 ; exit 1 ; \
         fi ; \
         echo "[just] tag $VERSION already exists locally at $LOCAL — resuming push" ; \
     else \
         echo "[just] tagging $VERSION at $LOCAL" ; \
         git tag -a "$VERSION" -m "Release $VERSION" ; \
         CREATED_TAG=yes ; \
     fi ; \
     echo "[just] pushing $VERSION to origin" ; \
     if ! git push origin "$VERSION"; then \
         if [ "$CREATED_TAG" = "yes" ]; then \
             echo "[just] push failed; rolling back local tag $VERSION" >&2 ; \
             git tag -d "$VERSION" >/dev/null ; \
         fi ; \
         exit 1 ; \
     fi ; \
     REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "<owner>/<repo>") ; \
     echo "[just] released — watch: https://github.com/$REPO/actions/workflows/release.yml"

# ── Deploy ───────────────────────────────────────────────────────
# Dispatch the Forgejo deploy.yml that owns this app's compose stack. Separate
# from `release`: that one only pushes a tag, and the GitHub release workflow
# deploys on its own once the image is actually published. Use this to redeploy
# without cutting a release.
#
# .env (tracked):                    FORGEJO_DEPLOY_APP
# .local/deploy.env (gitignored):    FORGEJO_HOST, FORGEJO_REPO, FORGEJO_TOKEN
#
#   just deploy              # deploys FORGEJO_DEPLOY_APP
#   just deploy app-other    # deploys something else
#
# Dispatch the Forgejo deploy workflow for this app (no release needed).
deploy APP='':
    @set -e ; \
     set -a ; . ./.env ; [ -f .local/deploy.env ] && . ./.local/deploy.env ; set +a ; \
     APP="{{APP}}" ; APP="${APP:-${FORGEJO_DEPLOY_APP:-}}" ; \
     MISSING="" ; \
     [ -n "${FORGEJO_HOST:-}" ]  || MISSING="$MISSING FORGEJO_HOST(.local/deploy.env)" ; \
     [ -n "${FORGEJO_REPO:-}" ]  || MISSING="$MISSING FORGEJO_REPO(.local/deploy.env)" ; \
     [ -n "${FORGEJO_TOKEN:-}" ] || MISSING="$MISSING FORGEJO_TOKEN(.local/deploy.env)" ; \
     [ -n "$APP" ]           || MISSING="$MISSING FORGEJO_DEPLOY_APP(.env) or an APP argument" ; \
     if [ -n "$MISSING" ]; then \
         echo "[just] error: missing$MISSING" >&2 ; exit 1 ; \
     fi ; \
     URL="${FORGEJO_HOST}/api/v1/repos/${FORGEJO_REPO}/actions/workflows/deploy.yml/dispatches" ; \
     echo "[deploy] dispatching $APP via $FORGEJO_REPO" ; \
     CODE=$(curl -sS -o /tmp/cc-deploy-resp -w '%{http_code}' -X POST "$URL" \
         -H "Authorization: token $FORGEJO_TOKEN" \
         -H "Content-Type: application/json" \
         -d "{\"ref\":\"main\",\"inputs\":{\"app\":\"$APP\"}}") ; \
     if [ "$CODE" != "204" ] && [ "$CODE" != "201" ] && [ "$CODE" != "200" ]; then \
         echo "[just] error: Forgejo returned $CODE" >&2 ; cat /tmp/cc-deploy-resp >&2 ; echo >&2 ; exit 1 ; \
     fi ; \
     echo "[deploy] queued — watch: $FORGEJO_HOST/$FORGEJO_REPO/actions"

# ── Cleanup ──────────────────────────────────────────────────────
clean:
    @SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml down --volumes --rmi local 2>/dev/null || true ; \
     docker compose -f docker-compose.test.yml down --volumes --rmi local 2>/dev/null || true
    rm -f .local/worktree-ports.json

# Wipe this worktree's cache volume (clones + manifest/timeline/blob caches); re-clones + re-scans on next `just dev`.
clean-cache:
    @SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml down 2>/dev/null || true ; \
     docker volume rm codecity-${SLUG}_codecity-cache 2>/dev/null || true ; \
     echo "[codecity] wiped cache volume codecity-${SLUG}_codecity-cache"
