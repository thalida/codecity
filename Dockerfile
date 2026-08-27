# syntax=docker/dockerfile:1.7

# ─────── Stage 1: build the frontend ───────
FROM node:24-bookworm-slim AS web-builder
# The container's own npm is stricter about lockfile shape and refuses npm ci on
# a host-generated lockfile. Mirrored in .env and ci.yml — bump all three.
ARG NPM_VERSION=11.6.2
RUN npm install -g npm@${NPM_VERSION}
WORKDIR /build/app
COPY packages/app/package.json packages/app/package-lock.json ./
# The app links @codecity/city via `file:../city`, so npm needs that manifest
# first. .npmrc rides along: legacy-peer-deps for openapi-typescript's peer range.
COPY packages/city/package.json packages/city/.npmrc /build/city/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY packages/city/ /build/city/
COPY packages/app/ ./
RUN npm run build
# Output: /build/app/dist/

# ─────── Stage 2: runtime ───────
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CODECITY_CACHE_ROOT=/cache \
    UV_LINK_MODE=copy

# Upgrade before installing: the base image's apt snapshot lags, and Trivy fails
# CI on fixed HIGH/CRITICAL OS CVEs. ci.yml keeps this stage out of the cache,
# or a cached copy pins the upgrade to the day it was first built.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        git git-lfs ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

# uv is the package manager, so pip is dead weight whose vendored msgpack and
# setuptools Trivy fails on. The find guards the glob against a silent no-op.
RUN rm -rf /usr/local/lib/python3.*/site-packages/pip \
           /usr/local/lib/python3.*/site-packages/pip-*.dist-info \
    && rm -f /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.* \
    && ! find /usr/local/lib -name 'pip' -maxdepth 5 -print | grep -q .

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /srv

# Lockfile first, so a source change doesn't bust the dep layer. README+LICENSE
# ride along: pyproject references them and hatchling validates them at build.
COPY packages/api/pyproject.toml packages/api/uv.lock packages/api/README.md packages/api/LICENSE ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY packages/api/api/ ./api/

# Matches api/app.py's DEFAULT_STATIC_DIR (__file__.parent / "static").
COPY --from=web-builder /build/app/dist /srv/api/static

# hatch-vcs reads the version from git tags, and .dockerignore drops .git. The
# unscoped name is required: hatch-vcs 0.5.0 never forwards dist_name.
ARG VERSION=0.0.0+dev
ENV SETUPTOOLS_SCM_PRETEND_VERSION=${VERSION}

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# /cache is where the named volume lands.
RUN useradd --create-home --uid 10001 codecity \
    && mkdir -p /cache \
    && chown codecity:codecity /cache /srv
USER codecity

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=2s --start-period=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

# The venv's python directly: `uv run` would re-sync at startup and try to
# rewrite /srv/.venv/bin, which the non-root user cannot. Single process by
# design — api/core/security.py holds the trust set in memory.
ENTRYPOINT ["/srv/.venv/bin/python", "-m", "api"]
# The CLI defaults to loopback, which in a container means unreachable. Any
# `command:` override replaces this outright and must repeat it.
CMD ["--port", "8080", "--host", "0.0.0.0"]

ARG GIT_SHA=dev
ARG VERSION=0.0.0+dev
LABEL org.opencontainers.image.title="codecity" \
      org.opencontainers.image.description="Visualize any codebase as an isometric 3D city" \
      org.opencontainers.image.source="https://github.com/thalida/codecity" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="AGPL-3.0"
