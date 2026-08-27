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

# Serve this worktree at a STABLE public URL for phone testing:
# https://codecity-<branch-slug>.tunl.sh, fixed per branch across restarts.
# Starts `just run` itself (reusing it if that port is already serving) and
# opens the self-hosted sish tunnel; Ctrl-C stops both. Takes the same
# `-v` / `-e` flags as `run`, and needs your ssh agent to hold the key.
#
# `run`, not `dev`: sish carries every request over one SSH connection, and
# dev's 169 separately-served icon SVGs never all arrive, so the page hangs
# mid-boot. The built app bundles them. For HMR on a phone, use the LAN URL
# (host IP + the `just url` port) instead.
tunl *args='':
    @set -e ; \
     PORT=$(python3 bin/pick-port.py run) ; \
     SLUG=codecity-$( ( git symbolic-ref --short -q HEAD 2>/dev/null || basename $(pwd) ) | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     if curl -sf -o /dev/null --max-time 2 http://localhost:$PORT/ ; then \
         echo "[codecity-tunl] reusing the app already serving on :$PORT" ; \
     else \
         echo "[codecity-tunl] building + starting the app (first build takes a few minutes)" ; \
         trap 'kill 0' EXIT INT TERM ; \
         just run {{args}} & \
         until curl -sf -o /dev/null --max-time 2 http://localhost:$PORT/ ; do sleep 2 ; done ; \
     fi ; \
     echo "[codecity-tunl] https://$SLUG.tunl.sh/ -> localhost:$PORT" ; \
     ssh -p 2222 -R $SLUG:80:localhost:$PORT tunl.sh

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
# Runs locally (like `gen-types`) so reformatted files stay owned by you, not
# the container's root. Each npm package owns its own prettier and runs it over
# its own tree; nothing at the repo root formats anything.
fmt:
    cd packages/api && uv run ruff format api
    uv run --project packages/api ruff format --isolated bin scripts
    cd packages/app && npm run format
    cd packages/city && npm run format

# Every non-test check the pre-push gate runs, in containers, so the recipe and
# the gate can't diverge. Split by package the way `test` is.
lint: lint-api lint-app lint-packages

# ruff = lint + format check; pyright = strict types over the api package. Both read their
# config from pyproject.toml; pyright's binary version is pinned in .env.
lint-api: comment-check
    docker compose -f docker-compose.test.yml run --rm ruff
    docker compose -f docker-compose.test.yml run --rm pyright

# The `#` half of the comment cap eslint enforces on the app. Runs over the whole
# tree, not just what a push changes: unlike the JS side, there is no backlog.
comment-check *paths='packages/api/api bin scripts':
    uv run --project packages/api python bin/check-comments.py {{paths}}

# manifest.contract.ts guards manifest.ts against the generated types; this
# guards the generated types against the models they come from. Same two steps
# as `gen-types`, diffing instead of writing, so drift can only mean the models
# moved. The committed file is raw generator output and prettierignored: format
# it and this diff reports the formatting rather than the models.
check-types-fresh:
    @mkdir -p .local
    @uv run --project packages/api python scripts/gen_openapi.py > .local/openapi.generated.json
    @docker compose -f docker-compose.test.yml run --rm gentypes \
        || (echo "[codecity] packages/city/src/types/manifest.generated.ts is stale — run \`just gen-types\`" && exit 1)

# Reads NPM_VERSION from the repo-root .env file (canonical source for
# compose + just). Dockerfile ARG default and ci.yml `env:` block mirror it.
lint-app:
    @NPM_VERSION=$(grep '^NPM_VERSION=' .env | cut -d= -f2) ; \
     docker compose -f docker-compose.test.yml run --rm vitest \
         sh -c "npm install -g npm@$NPM_VERSION && npm ci && npm run lint && npm run typecheck && npm run format:check"

# city/: typecheck + format check.
lint-packages:
    docker compose -f docker-compose.test.yml run --rm packages

# ── Codegen ──────────────────────────────────────────────────────
# Regenerate packages/city/src/types/manifest.generated.ts from the live OpenAPI schema.
# Single source of truth: packages/api/api/models/*.py -> OpenAPI -> TS. Run after changing
# any wire model. The drift guard (manifest.contract.ts) fails typecheck if the
# hand-written types in manifest.ts fall out of sync with this generated file.
# .local/openapi.generated.json is the intermediate between the two steps,
# kept rather than piped so a failure in the second is inspectable. Nothing
# else reads it. (Not to be confused with the live /api/openapi.json route.)
gen-types:
    @mkdir -p .local
    @uv run --project packages/api python scripts/gen_openapi.py > .local/openapi.generated.json
    @cd packages/city && npx openapi-typescript ../../.local/openapi.generated.json -o src/types/manifest.generated.ts
    @echo "[codecity] regenerated packages/city/src/types/manifest.generated.ts"

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
# debug-gated ?shot= capture harness (packages/app/packages/city/capture). Needs `just dev`
# running in another terminal; reads its URL from `just url`. Installs the
# Playwright Chromium build on first run. The animated demo.mp4 has its own
# recipe (`just demo-video`). Pass shot names to redo only those:
# `just screenshots fireflies trees`.
screenshots *shots='':
    @URL=$(just url) ; \
     echo "[codecity] capturing README screenshots from $URL" ; \
     cd packages/app && npx playwright install chromium && \
     CODECITY_URL="$URL" node scripts/screenshots.mjs {{shots}}

# Regenerate packages/app/public/hero-city.webp: the wallpaper the landing paints before
# (and instead of) a city. Same headless harness as `just screenshots`, its own
# recipe so a README regen never churns a shipped asset. Captured at 1920x1080
# with a 2x device scale, so the file covers a 4K screen, then encoded to webp
# (needs cwebp: brew install webp). Needs `just dev` running in another terminal.
hero-image quality='82':
    @set -e ; \
     command -v cwebp >/dev/null || { echo "[just] error: cwebp not found (brew install webp)" >&2 ; exit 1 ; } ; \
     URL=$(just url) ; \
     echo "[codecity] capturing the landing wallpaper from $URL" ; \
     cd packages/app && npx playwright install chromium && \
     CODECITY_URL="$URL" node scripts/screenshots.mjs hero ; \
     cwebp -q {{quality}} -m 6 -quiet public/hero-city.png -o public/hero-city.webp ; \
     rm public/hero-city.png ; \
     echo "[codecity] wrote packages/app/public/hero-city.webp ($(du -h public/hero-city.webp | cut -f1), q={{quality}})"

# Regenerate the animated .github/readme/demo.mp4: a headless orbit of codecity
# rendering its own repo, recorded with Playwright and encoded to a small h264
# mp4 with ffmpeg (required: brew install ffmpeg). Needs `just dev` running.
# Also refreshes demo.webp, which is what the README actually embeds.
demo-video: && demo-webp
    @URL=$(just url) ; \
     echo "[codecity] recording demo.mp4 from $URL" ; \
     cd packages/app && npx playwright install chromium && \
     CODECITY_URL="$URL" node scripts/demo-video.mjs

# GitHub strips <video> from markdown, so the README embeds this webp. Not a
# gif: dark gradients over hundreds of hues break a 256-colour palette (9.3MB
# and banded, against 4.2MB here). Needs ffmpeg + webp; if img2webp won't run,
# brew install libtiff.
#
# Rebuild demo.webp from demo.mp4. Delay is derived from fps: they must agree
# or the webp plays at the wrong speed.
demo-webp quality='50' fps='12':
    @set -e ; \
     command -v ffmpeg >/dev/null || { echo "[just] error: ffmpeg not found (brew install ffmpeg)" >&2 ; exit 1 ; } ; \
     command -v img2webp >/dev/null || { echo "[just] error: img2webp not found (brew install webp)" >&2 ; exit 1 ; } ; \
     DELAY=$(( 1000 / {{fps}} )) ; \
     FRAMES=$(mktemp -d) ; \
     trap 'rm -rf "$FRAMES"' EXIT ; \
     ffmpeg -y -v error -i .github/readme/demo.mp4 \
         -vf "fps={{fps}},scale=800:-1:flags=lanczos" "$FRAMES/f_%04d.png" ; \
     img2webp -loop 0 -lossy -q {{quality}} -m 6 -d $DELAY "$FRAMES"/f_*.png \
         -o .github/readme/demo.webp >/dev/null ; \
     echo "[codecity] wrote .github/readme/demo.webp ($(du -h .github/readme/demo.webp | cut -f1), {{fps}}fps, q={{quality}})"

# ── Onboarding ───────────────────────────────────────────────────
# One-shot bootstrap for a fresh clone or new worktree: installs node_modules in
# each npm package (so local vitest, prettier and IDE intellisense work — the
# runtime itself uses Docker via `just dev`) and syncs the api's venv, plus the
# per-clone git hooks. There is no npm project at the repo root.
setup: install-hooks
    cd packages/app && npm install
    cd packages/city && npm install
    cd packages/api && uv sync
    @if [ ! -f .env.local ]; then \
         cp .env.local.example .env.local ; \
         echo "[just] seeded .env.local — your mount, flags and deploy credentials live there" ; \
     fi
    @echo "[just] setup complete — try 'just dev'"

# Add a worktree for an existing BRANCH, carrying over the gitignored files (.env.local, .claude/settings.json) git leaves behind.
worktree-setup BRANCH DIR='':
    @set -e ; \
     DIR="{{DIR}}" ; \
     [ -n "$DIR" ] || DIR=".claude/worktrees/$(printf '%s' '{{BRANCH}}' | tr '/' '+')" ; \
     git worktree add "$DIR" "{{BRANCH}}" ; \
     for f in .env.local .claude/settings.json ; do \
         if [ -f "$f" ] && [ ! -f "$DIR/$f" ]; then \
             mkdir -p "$DIR/$(dirname "$f")" ; \
             cp "$f" "$DIR/$f" ; \
             echo "[just] carried over $f" ; \
         fi ; \
     done ; \
     echo "[just] worktree ready at $DIR — cd there and run 'just setup'"

# Tear down a MERGED branch: docker stack, worktree, branch, and every volume its two project names own (swept by prefix, so no cache family is ever missed).
worktree-teardown BRANCH:
    @set -e ; \
     BRANCH='{{BRANCH}}' ; \
     if [ -z "$(gh pr list --state merged --head "$BRANCH" --json number -q '.[0].number' 2>/dev/null)" ]; then \
         echo "[just] refusing: no merged PR for $BRANCH" >&2 ; exit 1 ; \
     fi ; \
     WT=$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '/^worktree /{w=$2} /^branch /{if ($2==b) print w}') ; \
     if [ -n "$WT" ] && [ "$WT" = "$(git rev-parse --show-toplevel)" ]; then \
         echo "[just] refusing: run this from the main clone, not the worktree it removes" >&2 ; exit 1 ; \
     fi ; \
     SLUG=$(printf '%s' "$BRANCH" | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-*$//') ; \
     IDS=$(docker ps -aq --filter "name=codecity-$SLUG") ; \
     [ -z "$IDS" ] || { docker rm -f $IDS >/dev/null ; echo "[just] removed containers" ; } ; \
     docker network rm "codecity-${SLUG}_default" >/dev/null 2>&1 && echo "[just] removed network" || true ; \
     PREFIXES="codecity-${SLUG}_" ; \
     [ -z "$WT" ] || PREFIXES="$PREFIXES $(basename "$WT" | tr -cd '[:alnum:]-')_" ; \
     for p in $PREFIXES ; do \
         V=$(docker volume ls -q --filter "name=^$p") ; \
         [ -z "$V" ] || { docker volume rm $V >/dev/null ; echo "[just] removed volumes: $(echo $V | tr '\n' ' ')" ; } ; \
     done ; \
     [ -z "$WT" ] || git worktree remove "$WT" ; \
     git branch -D "$BRANCH" ; \
     git remote prune origin ; \
     echo "[just] tore down $BRANCH"

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
# Credentials: .env.local, seeded by `just setup`. No app argument, so this
# repo can only ever deploy its own FORGEJO_DEPLOY_APP.
#
# Redeploy production without cutting a release.
deploy:
    @set -e ; \
     set -a ; . ./.env ; [ -f .env.local ] && . ./.env.local ; set +a ; \
     APP="${FORGEJO_DEPLOY_APP:-}" ; \
     MISSING="" ; \
     [ -n "${FORGEJO_HOST:-}" ]  || MISSING="$MISSING FORGEJO_HOST(.env.local)" ; \
     [ -n "${FORGEJO_REPO:-}" ]  || MISSING="$MISSING FORGEJO_REPO(.env.local)" ; \
     [ -n "${FORGEJO_TOKEN:-}" ] || MISSING="$MISSING FORGEJO_TOKEN(.env.local)" ; \
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
