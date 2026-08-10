# syntax=docker/dockerfile:1.7

# ─────── Stage 1: build the frontend ───────
FROM node:24-bookworm-slim AS web-builder
# Pin npm to host version — container ships npm 11.13.0, which is stricter
# about lockfile shape and refuses npm ci with EUSAGE on the host-generated
# lockfile (missing @emnapi/core, @emnapi/runtime entries).
#
# Canonical version source: this ARG default. The repo-root `.env` file
# mirrors it for docker-compose + justfile; .github/workflows/ci.yml mirrors
# it as an `env:` block. Bump all three together.
ARG NPM_VERSION=11.6.2
RUN npm install -g npm@${NPM_VERSION}
WORKDIR /build
# .npmrc carries legacy-peer-deps=true (openapi-typescript's stale peer range
# vs TS 6) — it MUST be copied before `npm ci` or resolution fails with ERESOLVE.
COPY app/package.json app/package-lock.json app/.npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build
# Output: /build/dist/

# ─────── Stage 2: runtime ───────
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CODECITY_CACHE_ROOT=/cache \
    UV_LINK_MODE=copy

# System deps. The base image's apt snapshot can lag published security fixes,
# so apply available upgrades before installing — Trivy fails CI on FIXED
# HIGH/CRITICAL OS CVEs (e.g. libcurl, pulled in by git), and waiting on a base
# image rebuild leaves the gate red. Dependabot still bumps the base tag.
# Note: PID 1 init duties are handled by Docker's --init flag (compose: init: true),
# so we don't install tini here.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        git git-lfs ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

# uv is the package manager here, so pip is dead weight — and its vendored
# msgpack/setuptools are what Trivy fails us on. The find guards the glob:
# a base-image bump must not silently no-op and hand the CVEs back.
RUN rm -rf /usr/local/lib/python3.*/site-packages/pip \
           /usr/local/lib/python3.*/site-packages/pip-*.dist-info \
    && rm -f /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.* \
    && ! find /usr/local/lib -name 'pip' -maxdepth 5 -print | grep -q .

# uv: bring in the static binary from the official image.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /srv

# Lockfile-first layering: a source change won't bust the dep install layer.
# README.md + LICENSE are referenced by pyproject.toml and validated at
# wheel-build time by hatchling — copy them alongside the manifests.
COPY pyproject.toml uv.lock README.md LICENSE ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Python source
COPY api/ ./api/

# Built frontend → /srv/api/static (matches api/app.py DEFAULT_STATIC_DIR
# resolution: Path(__file__).resolve().parent / "static"). No env var needed.
COPY --from=web-builder /build/dist /srv/api/static

# pyproject.toml uses hatch-vcs (`source = "vcs"`) for dynamic versioning,
# but .dockerignore excludes .git to keep the build context small. Feed the
# version through setuptools_scm's escape hatch so the project install below
# can compute its version without a git repo. Use the unscoped
# SETUPTOOLS_SCM_PRETEND_VERSION because hatch-vcs 0.5.0 doesn't forward
# dist_name to setuptools_scm, so the _FOR_<NAME> form never matches.
ARG VERSION=0.0.0+dev
ENV SETUPTOOLS_SCM_PRETEND_VERSION=${VERSION}

# Install the project (registers `api` as importable; metadata for version).
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Non-root user. /cache is the mount point for the named volume.
RUN useradd --create-home --uid 10001 codecity \
    && mkdir -p /cache \
    && chown codecity:codecity /cache /srv
USER codecity

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=2s --start-period=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

# Invoke the venv's python directly. Bypassing `uv run` avoids a startup
# re-sync that re-downloads dev deps and tries to reinstall the console
# script into /srv/.venv/bin (read-only for the non-root runtime user).
# Zombie reaping + signal propagation are handled by Docker's --init.
# `python -m api` launches a single uvicorn process (api.app:app) — single
# process by design, see api/security.py (the allowed_roots trust set is
# in-memory; multi-worker would split it).
ENTRYPOINT ["/srv/.venv/bin/python", "-m", "api"]
# --host is explicit because the CLI defaults to loopback (an unauthenticated
# API that serves any scanned root should not reach the network by default).
# In a container that default would make the port unreachable from the host:
# here 0.0.0.0 is the container's own namespace, and only published ports get
# out. Any `command:` override must repeat this — see docker-compose.dev.yml.
CMD ["--port", "8080", "--host", "0.0.0.0"]

# Populated by CI via --build-arg.
ARG GIT_SHA=dev
ARG VERSION=0.0.0+dev
LABEL org.opencontainers.image.title="codecity" \
      org.opencontainers.image.description="Visualize any codebase as an isometric 3D city" \
      org.opencontainers.image.source="https://github.com/thalida/codecity" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="AGPL-3.0"
