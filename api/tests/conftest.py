"""Shared pytest fixtures for codecity api tests.

Centralizes test helpers that have been duplicated or scattered across the
suite. Future tasks (11-13) will migrate the existing test files to use
these fixtures; until then this module is purely additive and does NOT
disturb existing behavior.

Provides:

  - quiet_logs            (autouse, session): sets CODECITY_QUIET=1 for
                          the whole run, replacing the module-level
                          `os.environ["CODECITY_QUIET"] = "1"` statements
                          currently sitting at the top of test_scan.py /
                          test_server.py / test_clone.py.

  - redirect_cache_root   (opt-in, function): monkeypatches
                          `api.services.cache.CACHE_ROOT` and
                          `api.services.clone.CLONES_ROOT` at a per-test tempdir. Mirrors the behavior of
                          the three near-identical `_CacheRedirectMixin` /
                          `CacheTestBase` classes the migration will
                          delete. Opt-in (not autouse) so the existing
                          mixins keep working unchanged during the
                          incremental migration; once tasks 11-13 land,
                          this can be flipped to autouse if desired.

  - init_git_repo         (function): factory matching test_server.py's
                          `_init_git_repo(path, *, bare=False)`.

  - make_fake_remote      (function): factory matching test_clone.py's
                          `_make_fake_remote(tmp)` — builds a bare repo
                          with 'main' + 'feature' branches and a couple
                          of commits, returns (bare_path, "main").

  - http_helpers          (function): namespace bundling _get, _request,
                          _request_stream, _get_with_headers, and _delete
                          from test_server.py with their EXACT existing
                          return-shape contracts preserved.
"""

from __future__ import annotations

import gzip
import json
import os
import subprocess
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest


# ── Environment isolation ────────────────────────────────────────────


@pytest.fixture(autouse=True, scope="session")
def quiet_logs() -> Iterator[None]:
    """Suppress codecity's stderr scan/clone logs across the test run.

    Replaces the module-level ``os.environ["CODECITY_QUIET"] = "1"``
    statements at the top of test_scan.py / test_server.py / test_clone.py.
    Those leak across processes and can't be unset; a session fixture
    restores prior state on teardown.
    """
    prev = os.environ.get("CODECITY_QUIET")
    os.environ["CODECITY_QUIET"] = "1"
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop("CODECITY_QUIET", None)
        else:
            os.environ["CODECITY_QUIET"] = prev


@pytest.fixture(autouse=True, scope="session")
def allow_local_repos() -> Iterator[None]:
    """Enable local-repo scanning for the full test suite.

    The gate (CODECITY_ALLOW_LOCAL_REPOS) defaults to *off* in production
    but nearly every test that exercises a local scan path needs it on.
    Set it session-wide; tests that specifically test the *disabled* state
    use ``monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)``
    to override for their scope.
    """
    prev = os.environ.get("CODECITY_ALLOW_LOCAL_REPOS")
    os.environ["CODECITY_ALLOW_LOCAL_REPOS"] = "1"
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop("CODECITY_ALLOW_LOCAL_REPOS", None)
        else:
            os.environ["CODECITY_ALLOW_LOCAL_REPOS"] = prev


@pytest.fixture(autouse=True)
def _reset_trust() -> Iterator[None]:
    """Isolate the process-global TRUST set per test. create_app() no longer
    resets it (the factory must be side-effect-free on session auth state —
    see api/app.py), so tests reset it here instead of relying on the factory."""
    from api.security import TRUST

    TRUST.reset()
    yield


# ── Cache redirection ────────────────────────────────────────────────


@pytest.fixture
def redirect_cache_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> Path:
    """Point ``api.services.cache.CACHE_ROOT`` (and
    ``api.services.clone.CLONES_ROOT``) at a per-test tempdir so
    scan/manifest/clone writes don't pollute ``~/.cache/codecity/`` during
    tests.

    IMPORTANT: both modules bind their cache path at import time (from
    ``config.CACHE_ROOT``, itself read once from ``CODECITY_CACHE_ROOT``), so
    setting the env var in a fixture is a no-op for already-imported modules.
    We monkeypatch the per-module attribute directly.
    """
    from api.services import cache as cache_mod
    from api.services import clone as clone_mod

    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cache_mod, "CACHE_ROOT", cache_dir)
    # clone.CLONES_ROOT is `<root>/clones`; preserve that shape.
    monkeypatch.setattr(clone_mod, "CLONES_ROOT", cache_dir / "clones")
    return cache_dir


# ── Git helpers ──────────────────────────────────────────────────────


@pytest.fixture
def init_git_repo():
    """Factory matching ``test_server.py``'s ``_init_git_repo``.

    Initialize ``path`` as a git repo. Default is a working tree (what
    the scan endpoints now require). Pass ``bare=True`` for a bare-repo
    fixture. No commits are made — an empty working tree is still a
    valid working tree per ``git rev-parse --is-inside-work-tree``.
    """

    def _init(path: Path, *, bare: bool = False) -> None:
        args = ["git", "init", "-q"]
        if bare:
            args.append("--bare")
        args.append(str(path))
        subprocess.run(args, check=True)

    return _init


def _run(*args: str, cwd: Path) -> None:
    """Internal: run a git subcommand silently. Matches the ``_run``
    helper in test_clone.py."""
    subprocess.run(args, cwd=str(cwd), check=True, capture_output=True)


@pytest.fixture
def make_fake_remote():
    """Factory matching ``test_clone.py``'s ``_make_fake_remote``.

    Builds a tiny bare repo at ``tmp/remote.git`` with one initial commit
    on a 'main' branch and a 'feature' branch carrying a different file.
    Returns ``(remote_path, default_branch_name)``.
    """

    def _make(tmp: Path) -> tuple[Path, str]:
        work = tmp / "work"
        work.mkdir()
        _run("git", "init", "-q", "--initial-branch=main", cwd=work)
        _run("git", "config", "user.email", "test@example.com", cwd=work)
        _run("git", "config", "user.name", "Test", cwd=work)
        (work / "README.md").write_text("hello\n")
        _run("git", "add", "README.md", cwd=work)
        _run("git", "commit", "-q", "-m", "initial", cwd=work)
        _run("git", "checkout", "-q", "-b", "feature", cwd=work)
        (work / "FEATURE.md").write_text("on feature branch\n")
        _run("git", "add", "FEATURE.md", cwd=work)
        _run("git", "commit", "-q", "-m", "feature commit", cwd=work)
        _run("git", "checkout", "-q", "main", cwd=work)

        bare = tmp / "remote.git"
        _run("git", "clone", "-q", "--bare", str(work), str(bare), cwd=tmp)
        # Mark HEAD on the bare so symbolic-ref resolution works post-clone.
        _run("git", "symbolic-ref", "HEAD", "refs/heads/main", cwd=bare)
        return bare, "main"

    return _make


# ── HTTP helpers ─────────────────────────────────────────────────────


class _HTTPHelpers:
    """Namespace bundling the HTTP helpers currently inlined in
    test_server.py. Method signatures and return shapes are copied
    verbatim from the originals so callers can swap with no behavior
    change."""

    @staticmethod
    def get(url: str) -> tuple[int, bytes, str]:
        """GET → (status, body_bytes, content_type). Mirrors ``_get``."""
        try:
            resp = urllib.request.urlopen(url)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type", "")
        return resp.status, resp.read(), resp.headers.get("Content-Type", "")

    @staticmethod
    def get_with_headers(
        url: str, headers: dict[str, str],
    ) -> tuple[int, bytes, str, str]:
        """GET with custom request headers → (status, body, content_type,
        content_encoding). Body is raw bytes; tests that requested gzip
        decompress themselves. Mirrors ``_get_with_headers``."""
        req = urllib.request.Request(url, headers=headers)
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            return (
                e.code, e.read(),
                e.headers.get("Content-Type", ""),
                e.headers.get("Content-Encoding", ""),
            )
        return (
            resp.status, resp.read(),
            resp.headers.get("Content-Type", ""),
            resp.headers.get("Content-Encoding", ""),
        )

    @staticmethod
    def request(port: int, path: str) -> tuple[int, Any]:
        """GET local server → (status, parsed_json). Error bodies (4xx/5xx)
        are parsed from the HTTPError body. Mirrors ``_request``."""
        url = f"http://127.0.0.1:{port}{path}"
        try:
            resp = urllib.request.urlopen(url)
            return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    @staticmethod
    def request_stream(port: int, path: str) -> tuple[int, list[dict]]:
        """GET an NDJSON stream → (status, list_of_events). Sets
        Accept-Encoding: gzip and transparently decompresses. Error
        responses become a single-element list. Mirrors
        ``_request_stream``."""
        url = f"http://127.0.0.1:{port}{path}"
        req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"})
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            return e.code, [json.loads(e.read())]
        body = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        events = [json.loads(line) for line in body.splitlines() if line]
        return resp.status, events

    @staticmethod
    def delete(url: str) -> tuple[int, Any]:
        """DELETE → (status, parsed_json). Mirrors ``_delete``."""
        req = urllib.request.Request(url, method="DELETE")
        try:
            resp = urllib.request.urlopen(req)
            return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())


@pytest.fixture
def http_helpers() -> _HTTPHelpers:
    """Bundle the HTTP client helpers used by test_server.py as a single
    namespace fixture (``http.get(...)``, ``http.request(...)``,
    ``http.request_stream(...)``, ``http.get_with_headers(...)``,
    ``http.delete(...)``)."""
    return _HTTPHelpers()


# ── Session-scoped shared bare repo + per-test worktree ──────────────


@pytest.fixture(scope="session")
def _session_bare_repo(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One bare repo per pytest session, used as the source for
    per-test ``git worktree add`` operations.

    Building this once instead of per-test shaves ~20s off the suite
    (top 10 pytest tests previously each spent ~1s on git init).
    """
    bare = tmp_path_factory.mktemp("session-bare") / "origin.git"
    bare.mkdir(parents=True, exist_ok=True)
    _run("git", "init", "--bare", "-q", "--initial-branch=main", cwd=bare)
    # Seed with one empty commit so HEAD exists (worktree-add needs a ref)
    seed = tmp_path_factory.mktemp("session-seed") / "seed"
    _run("git", "clone", "-q", str(bare), str(seed), cwd=seed.parent)
    _run("git", "config", "user.email", "test@example.com", cwd=seed)
    _run("git", "config", "user.name", "Test", cwd=seed)
    _run("git", "commit", "--allow-empty", "-q", "-m", "session seed", cwd=seed)
    _run("git", "push", "-q", "origin", "main", cwd=seed)
    return bare


@pytest.fixture
def git_working_tree(_session_bare_repo: Path, tmp_path: Path) -> Iterator[Path]:
    """Per-test git working tree. Cheap: ``git worktree add`` off of the
    session-scoped bare repo.
    """
    wt = tmp_path / "wt"
    _run("git", "worktree", "add", "-q", str(wt), "main", cwd=_session_bare_repo)
    yield wt
    # Best-effort cleanup
    try:
        _run(
            "git", "worktree", "remove", "-q", "--force", str(wt),
            cwd=_session_bare_repo,
        )
    except subprocess.CalledProcessError:
        pass
