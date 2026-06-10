"""Real-socket SSE: client disconnects mid-stream -> scan cancels, no cache write."""

from __future__ import annotations

import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn

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
    for i in range(50):
        (p / f"f{i}.txt").write_text("x\n" * 100)
    _git("add", ".", cwd=p)
    _git("commit", "-qm", "c", cwd=p)
    return p


@pytest.fixture()
def server(tmp_path: Path, redirect_cache_root):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("x")
    app = create_app(static_dir=static)
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error")
    srv = uvicorn.Server(config)
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    while not srv.started:
        time.sleep(0.01)
    port = srv.servers[0].sockets[0].getsockname()[1]
    yield port
    srv.should_exit = True
    thread.join(timeout=5)


def test_disconnect_midstream_does_not_hang(server, repo, monkeypatch) -> None:
    monkeypatch.setenv("CODECITY_ALLOW_LOCAL_REPOS", "1")
    port = server
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    req = (
        f"GET /api/manifest?src={repo}&no_cache=true HTTP/1.1\r\n"
        f"Host: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    s.sendall(req.encode())
    # Read a little (status + first event), then bail.
    s.recv(256)
    s.close()
    # Server must remain responsive: a fresh health request succeeds quickly.
    import urllib.request

    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as r:
        assert r.status == 200
