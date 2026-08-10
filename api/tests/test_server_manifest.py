"""TestClient coverage for the /api/manifest SSE stream (happy path + errors + cache)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.routers.manifest import _norm_excludes
from api.services.clone import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
)


def _git(*a: str, cwd: Path) -> None:
    subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    p = tmp_path / "repo"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "f.txt").write_text("hello\nworld\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c", cwd=p)
    return p


@pytest.fixture()
def client(tmp_path: Path, redirect_cache_root) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


@pytest.fixture()
def two_commit_repo(tmp_path: Path) -> tuple[Path, str]:
    """A repo with two commits; c2 adds b.txt on top of c1's a.txt.
    Returns (repo_path, c1_sha) so tests can request ?ref=<c1_sha> and
    assert b.txt is absent from the reconstructed tree."""
    p = tmp_path / "repo2"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "a.txt").write_text("hello\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c1", cwd=p)
    first_sha = (
        subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=p, check=True, capture_output=True
        )
        .stdout.decode()
        .strip()
    )
    (p / "b.txt").write_text("world\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c2", cwd=p)
    return p, first_sha


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    name = "message"
    data_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("event:"):
            name = line[len("event:") :].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:") :].strip())
        elif line == "":
            if data_lines:
                events.append((name, json.loads("".join(data_lines))))
            name, data_lines = "message", []
    return events


class TestExcludeParam:
    def test_normalizer_strips_and_drops_empties(self) -> None:
        assert _norm_excludes(["", " sub ", "/a.md", "sub"]) == frozenset(
            {"sub", "a.md"}
        )


def test_manifest_stream_local(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    with client.stream(
        "GET", "/api/manifest", params={"src": str(repo), "no_cache": "true"}
    ) as r:
        assert r.status_code == 200
        assert "text/event-stream" in r.headers["content-type"]
        body = "".join(r.iter_text())
    events = _parse_sse(body)
    names = [n for n, _ in events]
    assert "scan-progress" in names
    assert names[-1] == "manifest-complete"
    final = events[-1][1]
    assert final["manifest"]["root"]
    assert final["manifest"]["tree"]["type"] == "directory"


def test_manifest_stream_missing_src_emits_error_event(client: TestClient) -> None:
    with client.stream("GET", "/api/manifest") as r:
        assert r.status_code == 200
        body = "".join(r.iter_text())
    events = _parse_sse(body)
    assert events[-1][0] == "error"
    assert "src" in events[-1][1]["error"]


def test_manifest_stream_local_disabled_error_event(
    client: TestClient, repo: Path, monkeypatch
) -> None:
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    with client.stream("GET", "/api/manifest", params={"src": str(repo)}) as r:
        body = "".join(r.iter_text())
    events = _parse_sse(body)
    assert events[-1][0] == "error"
    assert "disabled" in events[-1][1]["error"]


def test_manifest_cold_scan_then_warm_cache_hit(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    # First request WITHOUT no_cache: cold scan must emit manifest-partial +
    # manifest-complete AND write the manifest cache (the bug-fix under test).
    with client.stream("GET", "/api/manifest", params={"src": str(repo)}) as r:
        cold = _parse_sse("".join(r.iter_text()))
    cold_names = [n for n, _ in cold]
    assert "manifest-partial" in cold_names
    assert cold_names[-1] == "manifest-complete"

    # Second request: warm-cache hit -> single manifest-complete, NO partial.
    with client.stream("GET", "/api/manifest", params={"src": str(repo)}) as r:
        warm = _parse_sse("".join(r.iter_text()))
    warm_names = [n for n, _ in warm]
    assert "manifest-partial" not in warm_names, f"expected warm hit, got {warm_names}"
    assert warm_names[-1] == "manifest-complete"


def test_manifest_stream_gzip_when_accepted(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    # Accept-Encoding: gzip -> stream is gzip-compressed (browsers/httpx decode
    # transparently). httpx auto-decompresses but keeps the header; the events
    # round-trip intact.
    with client.stream(
        "GET",
        "/api/manifest",
        params={"src": str(repo), "no_cache": "true"},
        headers={"Accept-Encoding": "gzip"},
    ) as r:
        assert r.headers.get("content-encoding") == "gzip"
        events = _parse_sse("".join(r.iter_text()))
    assert [n for n, _ in events][-1] == "manifest-complete"


def test_manifest_stream_uncompressed_when_not_accepted(
    client: TestClient, repo: Path, allow_local_repos
) -> None:
    # No gzip in Accept-Encoding -> served uncompressed (raw sockets / odd proxies).
    with client.stream(
        "GET",
        "/api/manifest",
        params={"src": str(repo), "no_cache": "true"},
        headers={"Accept-Encoding": "identity"},
    ) as r:
        assert "content-encoding" not in r.headers
        events = _parse_sse("".join(r.iter_text()))
    assert [n for n, _ in events][-1] == "manifest-complete"


def test_manifest_at_ref_returns_old_tree(
    client: TestClient, two_commit_repo: tuple[Path, str], allow_local_repos
) -> None:
    repo_path, old_sha = two_commit_repo
    with client.stream(
        "GET",
        "/api/manifest",
        params={"src": str(repo_path), "ref": old_sha, "no_cache": "true"},
    ) as r:
        assert r.status_code == 200
        events = _parse_sse("".join(r.iter_text()))
    # No skeleton for a ref: only manifest-complete, never scan-progress/partial.
    assert [n for n, _ in events] == ["manifest-complete"]
    tree = events[-1][1]["manifest"]["tree"]
    names = {c["name"] for c in tree["children"] if c["type"] == "file"}
    assert "b.txt" not in names  # added in c2, after old_sha
    assert "a.txt" in names


def test_manifest_ref_warm_cache_hit(
    client: TestClient, two_commit_repo: tuple[Path, str], allow_local_repos
) -> None:
    repo_path, old_sha = two_commit_repo
    params = {"src": str(repo_path), "ref": old_sha}
    with client.stream("GET", "/api/manifest", params=params) as r:
        cold = _parse_sse("".join(r.iter_text()))
    with client.stream("GET", "/api/manifest", params=params) as r:
        warm = _parse_sse("".join(r.iter_text()))
    assert [n for n, _ in cold] == ["manifest-complete"]
    assert [n for n, _ in warm] == ["manifest-complete"]
    assert cold[-1][1]["manifest"] == warm[-1][1]["manifest"]


def test_manifest_bad_ref_emits_error_event(
    client: TestClient, two_commit_repo: tuple[Path, str], allow_local_repos
) -> None:
    repo_path, _ = two_commit_repo
    with client.stream(
        "GET", "/api/manifest", params={"src": str(repo_path), "ref": "nope123"}
    ) as r:
        events = _parse_sse("".join(r.iter_text()))
    assert events[-1][0] == "error"
    assert "ref" in events[-1][1]["error"]


class TestErrorCode:
    """The `code` on an error event is what the client keys its remedy on, so
    it must appear for a remote not-found and for nothing else. GitHub 404s a
    private repo to an unauthenticated caller exactly as it 404s a typo, so
    the remedy this unlocks can never assert the repo is private."""

    REMOTE = "https://github.com/thalida/definitely-not-a-real-repo"

    def _error_payload(self, client: TestClient, params: dict) -> dict:
        with client.stream("GET", "/api/manifest", params=params) as r:
            events = _parse_sse("".join(r.iter_text()))
        assert events[-1][0] == "error"
        return events[-1][1]

    def test_remote_not_found_carries_the_code(
        self, client: TestClient, monkeypatch
    ) -> None:
        def _boom(*a, **kw):
            raise RepoNotFoundError("repository not found")

        monkeypatch.setattr("api.routers.manifest.ensure_clone", _boom)
        payload = self._error_payload(client, {"src": self.REMOTE})
        assert payload["code"] == "repo-not-found"

    @pytest.mark.parametrize(
        "exc", [BranchNotFoundError, HostUnreachableError, CloneError]
    )
    def test_other_remote_failures_carry_no_code(
        self, client: TestClient, monkeypatch, exc
    ) -> None:
        def _boom(*a, **kw):
            raise exc("nope")

        monkeypatch.setattr("api.routers.manifest.ensure_clone", _boom)
        assert "code" not in self._error_payload(client, {"src": self.REMOTE})

    def test_missing_local_path_carries_no_code(
        self, client: TestClient, tmp_path: Path, allow_local_repos
    ) -> None:
        """A local path that isn't there is a typo the user can see and fix,
        not a repo the server might lack access to."""
        payload = self._error_payload(client, {"src": str(tmp_path / "gone")})
        assert "code" not in payload

    def test_local_disabled_carries_no_code(
        self, client: TestClient, repo: Path, monkeypatch
    ) -> None:
        monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
        assert "code" not in self._error_payload(client, {"src": str(repo)})

    def test_timeline_remote_not_found_carries_the_code(
        self, client: TestClient, monkeypatch
    ) -> None:
        """The timeline route resolves through resolve_source, which flattens
        clone failures into a ResolveError; the code has to survive that."""

        def _boom(*a, **kw):
            raise RepoNotFoundError("repository not found")

        monkeypatch.setattr("api.services.source.ensure_clone", _boom)
        with client.stream("GET", "/api/timeline", params={"src": self.REMOTE}) as r:
            events = _parse_sse("".join(r.iter_text()))
        assert events[-1][0] == "error"
        assert events[-1][1]["code"] == "repo-not-found"
