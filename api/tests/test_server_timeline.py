"""TestClient coverage for the /api/timeline SSE stream (progress + bundle + cache)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


def _git(*a: str, cwd: Path) -> None:
    subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)


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


@pytest.fixture()
def client(tmp_path: Path, redirect_cache_root) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    return TestClient(create_app(static_dir=static))


@pytest.fixture()
def two_commit_repo(tmp_path: Path) -> Path:
    p = tmp_path / "repo"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "a.txt").write_text("hello\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c1", cwd=p)
    (p / "b.txt").write_text("world\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c2", cwd=p)
    return p


def test_timeline_missing_src_400(client: TestClient) -> None:
    assert client.get("/api/timeline").status_code in (400, 422)


def test_timeline_stream_emits_progress_then_bundle(
    client: TestClient, two_commit_repo: Path, allow_local_repos
) -> None:
    with client.stream(
        "GET",
        "/api/timeline",
        params={"src": str(two_commit_repo), "no_cache": "true"},
    ) as r:
        assert r.status_code == 200
        assert "text/event-stream" in r.headers["content-type"]
        body = "".join(r.iter_text())
    events = _parse_sse(body)
    names = [n for n, _ in events]
    # The blob-table stage always reports a start + done tick (its total is
    # known up front from the batch blob-check), so even a 2-blob repo trips it.
    assert "timeline-progress" in names
    assert names[-1] == "timeline-complete"
    # Stage order is what the client's step rows are driven off, and `assemble`
    # is the one that covers the union build — the longest silent stretch.
    stages = [d["stage"] for n, d in events if n == "timeline-progress"]
    assert [s for i, s in enumerate(stages) if i == 0 or s != stages[i - 1]] == [
        "history",
        "blobs",
        "assemble",
    ]
    bundle = events[-1][1]["bundle"]
    assert set(bundle) >= {
        "commits",
        "unionManifest",
        "deltas",
        "blobLines",
        "blobSizes",
        "notes",
    }
    # Every referenced sha resolves in both tables, so the client can't KeyError.
    for delta in bundle["deltas"]:
        for change in delta["changes"]:
            if change["sha"] is not None:
                assert change["sha"] in bundle["blobLines"]
                assert change["sha"] in bundle["blobSizes"]
    assert len(bundle["commits"]) == 2


def test_timeline_stream_history_heartbeat(
    client: TestClient, tmp_path: Path, allow_local_repos, monkeypatch
) -> None:
    """Lower the commit-count heartbeat threshold so a small repo still trips
    the `history` stage (production cadence is every ~2000 commits)."""
    from api.scan import timeline as timeline_service

    monkeypatch.setattr(timeline_service, "_HISTORY_HEARTBEAT_EVERY", 1)
    p = tmp_path / "repo3"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    for i in range(3):
        (p / f"f{i}.txt").write_text(f"{i}\n")
        _git("add", ".", cwd=p)
        _git("commit", "-qm", f"c{i}", cwd=p)

    with client.stream(
        "GET", "/api/timeline", params={"src": str(p), "no_cache": "true"}
    ) as r:
        events = _parse_sse("".join(r.iter_text()))
    history_events = [
        d for n, d in events if n == "timeline-progress" and d["stage"] == "history"
    ]
    assert len(history_events) >= 1
    assert history_events[-1]["commits"] == 3
    assert events[-1][0] == "timeline-complete"


def test_timeline_cold_scan_then_warm_cache_hit(
    client: TestClient, two_commit_repo: Path, allow_local_repos
) -> None:
    src = str(two_commit_repo)
    with client.stream("GET", "/api/timeline", params={"src": src}) as r:
        cold = _parse_sse("".join(r.iter_text()))
    cold_names = [n for n, _ in cold]
    assert cold_names[-1] == "timeline-complete"

    # Warm-cache hit: single timeline-complete, NO progress at all.
    with client.stream("GET", "/api/timeline", params={"src": src}) as r:
        warm = _parse_sse("".join(r.iter_text()))
    warm_names = [n for n, _ in warm]
    assert warm_names == ["timeline-complete"]
    assert cold[-1][1]["bundle"] == warm[-1][1]["bundle"]


def test_timeline_exclude_param_filters_bundle(
    client: TestClient, tmp_path: Path, allow_local_repos
) -> None:
    p = tmp_path / "repo"
    p.mkdir()
    _git("init", "-q", cwd=p)
    _git("config", "user.email", "a@b.c", cwd=p)
    _git("config", "user.name", "T", cwd=p)
    (p / "keep.txt").write_text("hi\n")
    (p / "secrets").mkdir()
    (p / "secrets" / "token.txt").write_text("shh\n")
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c1", cwd=p)

    def union_paths(params: dict) -> set[str]:
        with client.stream("GET", "/api/timeline", params=params) as r:
            events = _parse_sse("".join(r.iter_text()))
        bundle = events[-1][1]["bundle"]
        found: set[str] = set()

        def walk(n: dict) -> None:
            if n["type"] == "file":
                found.add(n["path"])
            else:
                for ch in n["children"]:
                    walk(ch)

        walk(bundle["unionManifest"]["tree"])
        return found

    src = str(p)
    assert "secrets/token.txt" in union_paths({"src": src})
    # Same HEAD, but excluding "secrets" must serve a distinct (filtered) bundle,
    # not the warm-cache hit from the unfiltered request above.
    filtered = union_paths({"src": src, "exclude": "secrets"})
    assert "keep.txt" in filtered
    assert not any(pth.startswith("secrets") for pth in filtered)


def test_timeline_bad_src_emits_error_event(
    client: TestClient, tmp_path: Path, allow_local_repos
) -> None:
    not_a_repo = tmp_path / "not-a-repo"
    not_a_repo.mkdir()
    with client.stream("GET", "/api/timeline", params={"src": str(not_a_repo)}) as r:
        assert r.status_code == 200
        events = _parse_sse("".join(r.iter_text()))
    assert events[-1][0] == "error"


def test_timeline_local_disabled_error_event(
    client: TestClient, two_commit_repo: Path, monkeypatch
) -> None:
    monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
    with client.stream(
        "GET", "/api/timeline", params={"src": str(two_commit_repo)}
    ) as r:
        assert r.status_code == 200
        events = _parse_sse("".join(r.iter_text()))
    assert events[-1][0] == "error"
    assert "disabled" in events[-1][1]["error"]
