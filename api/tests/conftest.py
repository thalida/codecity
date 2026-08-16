"""Shared pytest fixtures and helpers for the codecity api tests.

Fixtures:
  - quiet_logs          (autouse, session) CODECITY_QUIET=1 for the whole run
  - allow_local_repos   (autouse, session)
  - redirect_cache_root (function) per-test CACHE_ROOT / CLONES_ROOT tempdir
  - init_git_repo       (function) factory for a working or bare repo
  - make_fake_remote    (function) bare repo with 'main' + 'feature'
  - http_helpers        (function) _get / _request / _request_stream / _delete
  - git_working_tree    (function) checkout of a session-scoped bare repo

Helpers (imported directly, not injected): init_repo, commit_all,
ensure_fixture + FIXTURE, walk_files, walk_dirs, final_manifest, and
CacheRedirectMixin for unittest-style classes.
"""

from __future__ import annotations

import fcntl
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from api.models.manifest import CommitEntry, DirNode, FileNode, Manifest, TimelineBundle


# ── Environment isolation ────────────────────────────────────────────


@pytest.fixture(autouse=True, scope="session")
def quiet_logs() -> Iterator[None]:
    """Suppress codecity's stderr scan/clone logs across the test run.

    A fixture rather than a module-level ``os.environ`` assignment: those leak
    across processes and can't be unset, while this restores prior state on
    teardown.
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
    """Isolate the process-global TRUST set per test. create_app() does not
    reset it (the factory must be side-effect-free on session auth state — see
    api/app.py), so tests reset it here rather than relying on the factory."""
    from api.core.security import TRUST

    TRUST.reset()
    yield


# ── Cache redirection ────────────────────────────────────────────────


@pytest.fixture
def redirect_cache_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    """Point ``api.cache.paths.CACHE_ROOT`` (and
    ``api.git.clone.CLONES_ROOT``) at a per-test tempdir so
    scan/manifest/clone writes don't pollute ``~/.cache/codecity/`` during
    tests.

    IMPORTANT: both modules bind their cache path at import time (from
    ``config.CACHE_ROOT``, itself read once from ``CODECITY_CACHE_ROOT``), so
    setting the env var in a fixture is a no-op for already-imported modules.
    We monkeypatch the per-module attribute directly.
    """
    from api.cache import paths as cache_paths
    from api.git import clone as clone_mod

    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    # paths.py is the ONLY module that reads CACHE_ROOT, so this one patch
    # redirects the whole package.
    monkeypatch.setattr(cache_paths, "CACHE_ROOT", cache_dir)
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
        url: str,
        headers: dict[str, str],
    ) -> tuple[int, bytes, str, str]:
        """GET with custom request headers → (status, body, content_type,
        content_encoding). Body is raw bytes; tests that requested gzip
        decompress themselves. Mirrors ``_get_with_headers``."""
        req = urllib.request.Request(url, headers=headers)
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            return (
                e.code,
                e.read(),
                e.headers.get("Content-Type", ""),
                e.headers.get("Content-Encoding", ""),
            )
        return (
            resp.status,
            resp.read(),
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
            "git",
            "worktree",
            "remove",
            "-q",
            "--force",
            str(wt),
            cwd=_session_bare_repo,
        )
    except subprocess.CalledProcessError:
        pass


def final_manifest(root: str, **kwargs: Any) -> Any:
    """Drain scan_tree()'s stream and return the final-phase manifest.

    Most tests assert against the full manifest rather than the skeleton, and
    do not care about the phase iteration.
    """
    from api.scan.scanner import scan_tree

    final = None
    for event in scan_tree(root, **kwargs):
        if event.phase == "manifest-complete":
            final = event.manifest
    assert final is not None, "scan_tree must yield a final event"
    return final


# ── Scanner test scaffolding ─────────────────────────────────────────


def init_repo(root: Path) -> None:
    """``root`` as a git working tree with user.name/email set. The scanner
    rejects non-git roots, so every tempdir test builds one of these first."""
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "t"], check=True)


def commit_all(root: Path, message: str = "x") -> None:
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", message], check=True)


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
_CANONICAL_FIXTURE = FIXTURES_DIR / "sample-repo"


def _resolve_fixture() -> Path:
    """The sample-repo path this worker should use.

    Tests mutate FIXTURE (write .codecityignore, commit cache-bust files), and
    under xdist those writes race across processes, so each worker gets a
    private copy. Serial runs use the canonical in-tree path unchanged."""
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if not worker:
        return _CANONICAL_FIXTURE
    return (
        Path(tempfile.gettempdir()) / "codecity-test-fixtures" / worker / "sample-repo"
    )


FIXTURE = _resolve_fixture()


def ensure_fixture() -> None:
    """Build the canonical sample repo if setup.sh has changed, then make sure
    this worker's copy matches it.

    The flock serializes the setup.sh run across xdist workers; the per-worker
    marker records the same hash, so editing setup.sh invalidates stale copies
    too (a .git-exists check alone would silently reuse them)."""
    sentinel = FIXTURES_DIR / ".sample-repo-ready"
    lockfile_path = FIXTURES_DIR / ".sample-repo-setup.lock"
    setup_script = FIXTURES_DIR / "setup.sh"
    setup_hash = hashlib.sha256(setup_script.read_bytes()).hexdigest()
    lockfile_path.touch(exist_ok=True)
    with open(lockfile_path) as fp:
        fcntl.flock(fp.fileno(), fcntl.LOCK_EX)
        try:
            recorded = sentinel.read_text().strip() if sentinel.is_file() else ""
            if recorded != setup_hash:
                # Wipe partial state from an interrupted run so setup.sh's
                # `rm -rf` isn't the only safety net.
                if _CANONICAL_FIXTURE.exists():
                    shutil.rmtree(_CANONICAL_FIXTURE)
                subprocess.check_call(["bash", str(setup_script)])
                sentinel.write_text(setup_hash)
        finally:
            fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
    if FIXTURE == _CANONICAL_FIXTURE:
        return
    # Safe outside the lock: the sentinel guards future setup.sh runs and each
    # worker writes only its own FIXTURE path.
    worker_marker = FIXTURE.parent / ".sample-repo-ready"
    recorded = worker_marker.read_text().strip() if worker_marker.is_file() else ""
    if recorded != setup_hash or not (FIXTURE / ".git").is_dir():
        if FIXTURE.exists():
            shutil.rmtree(FIXTURE)
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(_CANONICAL_FIXTURE, FIXTURE)
        worker_marker.write_text(setup_hash)


class CacheRedirectMixin:
    """Pulls the ``redirect_cache_root`` fixture into unittest-style classes,
    which autouse fixtures reach but parameter-injected ones don't."""

    @pytest.fixture(autouse=True)
    def _redirect_cache_root(self, redirect_cache_root: Path) -> None:
        self.cache_root = redirect_cache_root


def make_file_node(path: str, **overrides: Any) -> FileNode:
    """A valid FileNode with defaults for everything a test isn't asserting on.

    The model requires every field, and most tests care about two or three, so
    the defaults carry the rest instead of each call spelling out a whole node.
    """
    name = path.rsplit("/", 1)[-1]
    fields: dict[str, Any] = {
        "name": name,
        "type": "file",
        "path": path,
        "fullPath": "/" + path,
        "extension": ("." + name.rsplit(".", 1)[-1]) if "." in name else "",
        "mediaKind": None,
        "size": 100,
        "lines": 10,
        "binary": False,
        "dirty": False,
        "created": "2020-01-01T00:00:00Z",
        "modified": "2020-01-01T00:00:00Z",
    }
    return FileNode.model_validate({**fields, **overrides})


def make_commit(sha: str = "0" * 40, **overrides: Any) -> CommitEntry:
    """A valid CommitEntry with defaults for whatever a test isn't asserting on.

    `same_day_total` defaults to 0, matching what the history walk and the cache
    produce before annotate_same_day_totals bakes the real figure."""
    fields: dict[str, Any] = {
        "date": "2026-01-01T00:00:00Z",
        "files": 1,
        "sha": sha,
        "authors": [],
        "subject": "",
        "same_day_total": 0,
    }
    return CommitEntry.model_validate({**fields, **overrides})


def make_dir_node(path: str, children: list[Any], **overrides: Any) -> DirNode:
    """A valid DirNode wrapping `children`.

    The rollup defaults are one level deep and exist so a fixture validates,
    NOT as a reference implementation — a test asserting on rollup values must
    build its tree through the real scanner (see `final_manifest`) or pass the
    values it expects as overrides.
    """
    files = [c for c in children if c.type == "file"]
    dirs = [c for c in children if c.type == "directory"]
    fields: dict[str, Any] = {
        "name": "root" if path == "." else path.rsplit("/", 1)[-1],
        "type": "directory",
        "path": path,
        "fullPath": "/" + path,
        "children": children,
        "children_count": len(children),
        "children_file_count": len(files),
        "children_dir_count": len(dirs),
        "descendants_count": len(children),
        "descendants_file_count": len(files),
        "descendants_dir_count": len(dirs),
        "descendants_size": sum(f.size for f in files),
        "descendants_created_min": min((f.created for f in files), default=None),
        "descendants_modified_max": max((f.modified for f in files), default=None),
        "descendants_ext_breakdown": [],
    }
    return DirNode.model_validate({**fields, **overrides})


def make_manifest(root: str = "/repo", **overrides: Any) -> Manifest:
    """A minimal but VALID Manifest, for tests about something other than the
    manifest's contents (cache round-trips, pruning, retention).

    Everything is empty or zeroed; a test that cares about real values should
    scan a repo through `final_manifest` instead of tuning these."""
    empty_range = {"min": 0, "max": 0}
    leaders = dict.fromkeys(
        (
            "oldestCreatedFile",
            "newestCreatedFile",
            "newestModifiedFile",
            "oldestModifiedFile",
            "maxLinesFile",
            "minLinesFile",
            "maxBytesFile",
            "minBytesFile",
            "maxMediaBytesFile",
            "minMediaBytesFile",
            "maxMediaPixelsFile",
            "minMediaPixelsFile",
            "maxBinaryBytesFile",
            "minBinaryBytesFile",
            "maxDepthDir",
            "maxChildrenDir",
            "minChildrenDir",
            "oldestCreatedDir",
            "newestCreatedDir",
            "maxFilesPerCommit",
            "minFilesPerCommit",
            "oldestCommit",
            "newestCommit",
            "maxCommitsPerDay",
        )
    )
    fields: dict[str, Any] = {
        "root": root,
        "scanned_at": "2026-05-17T00:00:00Z",
        "content_signature": "deadbeef" * 4,
        "structure_signature": "0" * 16,
        "layout_signature": "1" * 16,
        "tree": make_dir_node(".", [], name="repo", fullPath=root),
        "repo": {
            "branch": None,
            "remote_url": None,
            "head_sha": None,
            "head_subject": None,
            "dirty": False,
        },
        "commits": [],
        "busyness": {"avg": 1, "busy": 1},
        "dateRanges": dict.fromkeys(
            ("minCreated", "maxCreated", "minModified", "maxModified")
        ),
        "stats": {
            **leaders,
            "lineCountRange": empty_range,
            "byteSizeRange": empty_range,
            "mediaCount": 0,
            "binaryCount": 0,
            "totalLines": 0,
            "dirtyFileCount": 0,
            "codeBytes": 0,
            "commitCount": 0,
            "commitDates": {"oldest": None, "newest": None},
            "maxCommitStreakDays": 0,
            "authors": [],
        },
        "pending": [],
        "readmePath": None,
        "readmeModified": None,
    }
    return Manifest.model_validate({**fields, **overrides})


def make_timeline_bundle(**overrides: Any) -> TimelineBundle:
    """A minimal but VALID TimelineBundle, for the same kind of test."""
    fields: dict[str, Any] = {
        "commits": [],
        "unionManifest": make_manifest(),
        "deltas": [],
        "blobLines": {},
        "blobSizes": {},
        "commitLineRanges": [],
        "commitDateRanges": [],
        "note": None,
    }
    return TimelineBundle.model_validate({**fields, **overrides})


def walk_files(node: Any) -> Iterator[Any]:
    for child in node.children:
        if child.type == "file":
            yield child
        else:
            yield from walk_files(child)


def walk_dirs(node: Any) -> Iterator[Any]:
    for child in node.children:
        if child.type == "directory":
            yield child
            yield from walk_dirs(child)
