# Default: list available recipes.
default:
    @just --list

# ── Local run ────────────────────────────────────────────────────
# Dev mode: Vite HMR + api auto-reload. Worktree-aware.
# Takes docker's own flags (see bin/docker-args.py): `-v PATH` mounts a
# directory read-only at the same absolute path, `-e NAME=VALUE` sets an env
# var on the api. Both reach it through a generated compose override at
# .local/dev.override.yml (gitignored), layered onto the base dev compose.
#     just dev -v ~/Documents/Repos/myproj -e CODECITY_HOSTED=1
# Picks a free host port per worktree (persisted to .local/worktree-ports.json
# under key 'vite'), uses a branch-derived compose project name (so containers
# + volumes don't collide across branches/worktrees), and prints a subdomain
# URL so browser storage is isolated per branch. Falls back to the directory
# basename for detached HEAD. Auto-re-picks if the saved port becomes occupied.
dev *args='': install-hooks setup
    @set -e ; \
     OVERRIDE=$(python3 bin/docker-args.py compose {{args}}) ; \
     PORT=$(python3 bin/pick-port.py vite) ; \
     SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     echo "[codecity-dev] http://$SLUG.localhost:$PORT/" ; \
     VITE_HOST_PORT=$PORT \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml $OVERRIDE up --build

# Print this worktree's dev-server URL (same SLUG + port `just dev` binds).
# Reserves the vite port if `just dev` hasn't run yet. Handy: `open $(just url)`.
url:
    @PORT=$(python3 bin/pick-port.py vite) ; \
     SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     echo "http://$SLUG.localhost:$PORT/"

# Prod-like local run: one container, mirrors the README Quick Start.
# Takes the same `-v` / `-e` flags as `just dev`. Without a mount the container
# has no host filesystem access and can only render git URLs.
#     just run -v ~/Documents/Repos/myproj -e CODECITY_DISCOVER=off
# Picks a free host port per worktree (persisted to .local/worktree-ports.json
# under key 'run') so bookmarked URLs survive restarts AND concurrent worktrees
# don't fight over port 8080. Subdomain URL is branch-derived (falls back to
# directory basename on detached HEAD). Auto-re-picks if the saved port becomes
# occupied.
run *args='':
    @set -e ; \
     DOCKER_ARGS=$(python3 bin/docker-args.py run {{args}}) ; \
     PORT=$(python3 bin/pick-port.py run) ; \
     SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     echo "[codecity] http://$SLUG.localhost:$PORT/" ; \
     IMAGE_ID=$(docker build -q \
         --build-arg GIT_SHA=$(git rev-parse HEAD) \
         --build-arg VERSION=0.0.0+g$(git rev-parse --short HEAD) .) ; \
     docker run --rm --init \
         -v codecity-cache:/cache \
         $DOCKER_ARGS \
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
# re-runs dev. Accepts the same trailing args as `dev`.
reset-dev *args='':
    @SLUG=$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     docker compose -p codecity-$SLUG -f docker-compose.dev.yml rm -fs app
    @just dev {{args}}

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
    uv run ruff format api bin scripts

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
# Also refreshes demo.webp, which is what the README actually embeds.
demo-video: && demo-webp
    @URL=$(just url) ; \
     echo "[codecity] recording demo.mp4 from $URL" ; \
     cd app && npx playwright install chromium && \
     CODECITY_URL="$URL" node scripts/demo-video.mjs

# GitHub strips <video> from markdown, so the README embeds this webp. Not a
# gif: dark gradients over hundreds of hues break a 256-colour palette (9.3MB
# and banded, against 3.8MB here). Needs ffmpeg + webp; if img2webp won't run,
# brew install libtiff.
#
# Rebuild demo.webp from demo.mp4.
demo-webp quality='50':
    @set -e ; \
     command -v ffmpeg >/dev/null || { echo "[just] error: ffmpeg not found (brew install ffmpeg)" >&2 ; exit 1 ; } ; \
     command -v img2webp >/dev/null || { echo "[just] error: img2webp not found (brew install webp)" >&2 ; exit 1 ; } ; \
     FRAMES=$(mktemp -d) ; \
     trap 'rm -rf "$FRAMES"' EXIT ; \
     ffmpeg -y -v error -i .github/readme/demo.mp4 \
         -vf "fps=15,scale=800:-1:flags=lanczos" "$FRAMES/f_%04d.png" ; \
     img2webp -loop 0 -lossy -q {{quality}} -m 6 -d 67 "$FRAMES"/f_*.png \
         -o .github/readme/demo.webp >/dev/null ; \
     echo "[codecity] wrote .github/readme/demo.webp ($(du -h .github/readme/demo.webp | cut -f1), q={{quality}})"

# ── Onboarding ───────────────────────────────────────────────────
# One-shot bootstrap for a fresh clone or new worktree: installs app
# node_modules (so local vitest / IDE intellisense work — runtime
# itself uses Docker via `just dev`) and the per-clone git hooks.
setup: install-hooks
    cd app && npm install
    @mkdir -p .local ; \
     if [ ! -f .local/deploy.env ]; then \
         cp deploy.env.example .local/deploy.env ; \
         echo "[just] seeded .local/deploy.env — fill it in before 'just deploy'" ; \
     fi
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
# The tag triggers release.yml: build, sign, GitHub Release, deploy production.
# A tag left behind by a failed push is reused rather than duplicated.
#
# Tag and push a release (v1.2.3, v1.2.3-rc.1). Ships to production.
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
     echo "[just] released — builds, then deploys production" ; \
     echo "[just] watch: https://github.com/$REPO/actions/workflows/release.yml"

# ── Deploy ───────────────────────────────────────────────────────
# Config: .local/deploy.env, seeded by `just setup`. No app argument, so this
# repo can only ever deploy its own FORGEJO_DEPLOY_APP.
#
# Redeploy production without cutting a release.
deploy:
    @set -e ; \
     set -a ; . ./.env ; [ -f .local/deploy.env ] && . ./.local/deploy.env ; set +a ; \
     APP="${FORGEJO_DEPLOY_APP:-}" ; \
     MISSING="" ; \
     [ -n "${FORGEJO_HOST:-}" ]  || MISSING="$MISSING FORGEJO_HOST(.local/deploy.env)" ; \
     [ -n "${FORGEJO_REPO:-}" ]  || MISSING="$MISSING FORGEJO_REPO(.local/deploy.env)" ; \
     [ -n "${FORGEJO_TOKEN:-}" ] || MISSING="$MISSING FORGEJO_TOKEN(.local/deploy.env)" ; \
     [ -n "$APP" ]           || MISSING="$MISSING FORGEJO_DEPLOY_APP(.env)" ; \
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
