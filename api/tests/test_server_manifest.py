"""TestClient coverage for the /api/manifest SSE stream (happy path + errors + cache)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


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


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    name = "message"
    data_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("event:"):
            name = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:"):].strip())
        elif line == "":
            if data_lines:
                events.append((name, json.loads("".join(data_lines))))
            name, data_lines = "message", []
    return events


def test_manifest_stream_local(client: TestClient, repo: Path, allow_local_repos) -> None:
    with client.stream("GET", "/api/manifest", params={"src": str(repo), "no_cache": "true"}) as r:
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


def test_manifest_stream_local_disabled_error_event(client: TestClient, repo: Path, monkeypatch) -> None:
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    with client.stream("GET", "/api/manifest", params={"src": str(repo)}) as r:
        body = "".join(r.iter_text())
    events = _parse_sse(body)
    assert events[-1][0] == "error"
    assert "disabled" in events[-1][1]["error"]


def test_manifest_cold_scan_then_warm_cache_hit(client: TestClient, repo: Path, allow_local_repos) -> None:
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
