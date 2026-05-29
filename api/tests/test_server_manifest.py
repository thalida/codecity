"""Tests for /api/manifest streaming and its supporting machinery
(split from test_server.py).

Includes the route-level coverage plus the helpers and infra that back
the streaming endpoint (source classification, scan-target resolution,
disconnect handling, NDJSON event streaming, git working-tree gating)."""

from __future__ import annotations

import gzip
import io
import json
import socket
import threading
import unittest
import urllib.parse
import urllib.request
import zlib
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import pytest

from api import clone as clone_mod
from api import server as server_mod
from api.server import (
    _classify_source,
    _start_disconnect_watchdog,
    _stream_events,
    start_server,
)


class ManifestRouteTests(unittest.TestCase):
    """Coverage for /api/manifest at the HTTP layer — query handling,
    no_cache parsing, gzip negotiation, error codes."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(
        self, redirect_cache_root, init_git_repo, http_helpers,
    ) -> None:
        self.cache_root = redirect_cache_root
        self._init_git_repo = init_git_repo
        self._http = http_helpers

    def setUp(self) -> None:
        super().setUp()
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        static = Path(self.tmp.name) / "static"
        static.mkdir()
        (static / "index.html").write_text("<html><body>hi</body></html>")

        # A small directory we can scan in the manifest test. Initialized
        # as a git repo because the API now requires every local scan
        # target to be inside a git working tree.
        self.project = Path(self.tmp.name) / "project"
        self.project.mkdir()
        self._init_git_repo(self.project)
        (self.project / "README.md").write_text("# demo\n")

        self.server, self.port, self.shutdown = start_server(port=0, static_dir=static)
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"

    def test_manifest_route_scans_query_path(self) -> None:
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, events = self._http.request_stream(self.port, f"/api/manifest?{q}")
        self.assertEqual(status, HTTPStatus.OK)
        final = next(e for e in events if e["phase"] == "final")
        payload = final["manifest"]
        self.assertEqual(payload["tree"]["name"], "project")
        self.assertIn("signature", payload)
        # Successful scan must register the root.
        self.assertIn(self.project.resolve(), server_mod._State.allowed_roots)

    def test_manifest_missing_query_returns_400(self) -> None:
        status, body, _ = self._http.get(self.base + "/api/manifest")
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn("missing", json.loads(body)["error"])

    def test_manifest_nonexistent_path_returns_404(self) -> None:
        q = urllib.parse.urlencode({"src": str(self.project / "nope")})
        status, _, _ = self._http.get(self.base + f"/api/manifest?{q}")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_no_cache_query_param_truthy_parsing(self) -> None:
        from api.server import _parse_no_cache
        self.assertTrue(_parse_no_cache("no_cache=true"))
        self.assertTrue(_parse_no_cache("no_cache=TRUE"))
        self.assertTrue(_parse_no_cache("no_cache=1"))
        self.assertFalse(_parse_no_cache("no_cache=false"))
        self.assertFalse(_parse_no_cache("no_cache=0"))
        self.assertFalse(_parse_no_cache(""))
        self.assertFalse(_parse_no_cache("path=/tmp"))

    def test_manifest_response_gzipped_when_requested(self) -> None:
        # Client advertises gzip; server compresses the NDJSON stream;
        # decompressed body parses line-by-line as JSON events.
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, body, ctype, enc = self._http.get_with_headers(
            self.base + f"/api/manifest?{q}",
            {"Accept-Encoding": "gzip"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "gzip")
        self.assertEqual(ctype, "application/x-ndjson")
        decoded = gzip.decompress(body)
        events = [json.loads(line) for line in decoded.splitlines() if line]
        final = next(e for e in events if e["phase"] == "final")
        self.assertEqual(final["manifest"]["tree"]["name"], "project")

    def test_manifest_response_uncompressed_without_accept_encoding(self) -> None:
        # No Accept-Encoding header at all -> no Content-Encoding,
        # body parses directly as NDJSON.
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, body, ctype, enc = self._http.get_with_headers(
            self.base + f"/api/manifest?{q}", {},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        self.assertEqual(ctype, "application/x-ndjson")
        events = [json.loads(line) for line in body.splitlines() if line]
        final = next(e for e in events if e["phase"] == "final")
        self.assertEqual(final["manifest"]["tree"]["name"], "project")

    def test_manifest_response_uncompressed_when_gzip_not_in_accept(self) -> None:
        # Client supports brotli but not gzip -> no compression.
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, body, _, enc = self._http.get_with_headers(
            self.base + f"/api/manifest?{q}",
            {"Accept-Encoding": "br"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        # Sanity: each line is valid JSON.
        events = [json.loads(line) for line in body.splitlines() if line]
        self.assertGreaterEqual(len(events), 1)


class ClassifySourceTests(unittest.TestCase):
    def test_absolute_path(self) -> None:
        self.assertEqual(_classify_source("/Users/foo/bar"), "local")

    def test_home_path(self) -> None:
        self.assertEqual(_classify_source("~/code/foo"), "local")

    def test_relative_path_dot(self) -> None:
        self.assertEqual(_classify_source("./foo"), "local")
        self.assertEqual(_classify_source("../foo"), "local")

    def test_windows_drive_path(self) -> None:
        self.assertEqual(_classify_source("C:\\Users\\foo"), "local")
        self.assertEqual(_classify_source("D:/foo/bar"), "local")

    def test_https_url(self) -> None:
        self.assertEqual(_classify_source("https://github.com/owner/repo"), "git")
        self.assertEqual(_classify_source("http://example.com/x.git"), "git")

    def test_git_ssh_url(self) -> None:
        self.assertEqual(_classify_source("git@github.com:owner/repo.git"), "git")

    def test_garbage(self) -> None:
        self.assertEqual(_classify_source("garbage"), "invalid")
        self.assertEqual(_classify_source(""), "invalid")
        self.assertEqual(_classify_source("just-a-word"), "invalid")


class ResolveScanTargetTests(unittest.TestCase):
    """Behavior tests via the HTTP layer, since _resolve_scan_target is internal."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(self, init_git_repo, http_helpers) -> None:
        self._init_git_repo = init_git_repo
        self._http = http_helpers

    def setUp(self) -> None:
        self.server, self.server_port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)

    def test_local_path_ok(self) -> None:
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            (Path(td) / "x.py").write_text("print('hi')\n")
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}",
            )
            self.assertEqual(status, 200)
            final = next(e for e in events if e["phase"] == "final")["manifest"]
            # resolve() follows macOS /var -> /private/var symlinks; the
            # manifest's root field reflects the real resolved path.
            self.assertEqual(final.get("root"), str(Path(td).resolve()))

    def test_local_path_with_branch_silently_ignored(self) -> None:
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            (Path(td) / "x.py").write_text("print('hi')\n")
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}&branch=main",
            )
            self.assertEqual(status, 200)
            final = next(e for e in events if e["phase"] == "final")["manifest"]
            # display_root not set for in-place local scan
            self.assertNotIn("display_root", final)

    def test_invalid_source(self) -> None:
        status, body = self._http.request(self.server_port, "/api/manifest?src=garbage")
        self.assertEqual(status, 400)
        self.assertIn("unrecognized source", body.get("error", "").lower())

    def test_missing_src(self) -> None:
        status, body = self._http.request(self.server_port, "/api/manifest")
        self.assertEqual(status, 400)
        self.assertIn("'src'", body.get("error", ""))

    def test_old_path_param_rejected(self) -> None:
        # ?path= is no longer recognized — server should 400 missing 'src'.
        with TemporaryDirectory() as td:
            status, body = self._http.request(self.server_port, f"/api/manifest?path={td}")
            self.assertEqual(status, 400)
            self.assertIn("'src'", body.get("error", ""))

    def test_nonexistent_path(self) -> None:
        status, body = self._http.request(self.server_port, "/api/manifest?src=/this/does/not/exist/xyzzy")
        self.assertEqual(status, 404)
        self.assertIn("path not found", body.get("error", ""))

    def test_path_is_file_not_directory(self) -> None:
        with TemporaryDirectory() as td:
            f = Path(td) / "afile.txt"
            f.write_text("hi")
            status, body = self._http.request(self.server_port, f"/api/manifest?src={f}")
            self.assertEqual(status, 400)
            self.assertIn("not a directory", body.get("error", ""))


class DisplayRootTests(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def _setup_fixtures(
        self, init_git_repo, make_fake_remote, http_helpers,
    ) -> None:
        self._init_git_repo = init_git_repo
        self._make_fake_remote = make_fake_remote
        self._http = http_helpers

    def setUp(self) -> None:
        self.server, self.server_port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)

    def test_local_src_no_display_root(self) -> None:
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            (Path(td) / "x.py").write_text("\n")
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}",
            )
            self.assertEqual(status, 200)
            final = next(e for e in events if e["phase"] == "final")["manifest"]
            self.assertNotIn("display_root", final)

    def test_git_url_sets_display_root(self) -> None:
        # Use a local bare repo so we don't hit the network.
        with TemporaryDirectory() as td:
            remote, _ = self._make_fake_remote(Path(td))
            # Use a file:// URL so _classify_source returns 'git'.
            url = f"file://{remote}"
            # Monkey-patch CACHE_ROOT so we don't pollute ~/.cache.
            with mock.patch.object(clone_mod, "CACHE_ROOT", Path(td) / "cache"):
                status, events = self._http.request_stream(
                    self.server_port, f"/api/manifest?src={url}",
                )
            self.assertEqual(status, 200)
            final = next(e for e in events if e["phase"] == "final")["manifest"]
            self.assertEqual(final.get("display_root"), url)

    def test_git_url_with_branch_appends_at_branch(self) -> None:
        with TemporaryDirectory() as td:
            remote, _ = self._make_fake_remote(Path(td))
            url = f"file://{remote}"
            with mock.patch.object(clone_mod, "CACHE_ROOT", Path(td) / "cache"):
                status, events = self._http.request_stream(
                    self.server_port, f"/api/manifest?src={url}&branch=feature",
                )
            self.assertEqual(status, 200)
            final = next(e for e in events if e["phase"] == "final")["manifest"]
            self.assertEqual(final.get("display_root"), f"{url}@feature")

    def test_cloning_event_includes_display_root(self) -> None:
        # The first cloning event must carry display_root so the client
        # can show "{label} (pending)" before clone/scan even starts.
        with TemporaryDirectory() as td:
            remote, _ = self._make_fake_remote(Path(td))
            url = f"file://{remote}"
            with mock.patch.object(clone_mod, "CACHE_ROOT", Path(td) / "cache"):
                status, events = self._http.request_stream(
                    self.server_port, f"/api/manifest?src={url}",
                )
            self.assertEqual(status, 200)
            self.assertEqual(events[0]["phase"], "cloning")
            self.assertEqual(events[0].get("display_root"), url)

    def test_scanning_event_includes_display_root(self) -> None:
        # Local sources skip cloning; their first event is `scanning`,
        # which must also carry display_root (the raw local path the
        # caller passed in — the same value the final manifest omits).
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            (Path(td) / "x.py").write_text("\n")
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}",
            )
            self.assertEqual(status, 200)
            self.assertEqual(events[0]["phase"], "scanning")
            self.assertEqual(events[0].get("display_root"), td)


class ClientDisconnectTests(unittest.TestCase):
    """Browsers routinely close the TCP socket mid-response — tab reload,
    navigating away, or giving up on a multi-minute large-repo scan. The
    resulting BrokenPipeError / ConnectionResetError surfaces in
    BaseServer.handle_error, which would otherwise dump a full traceback
    to stderr for every disconnect. The server overrides handle_error to
    swallow those specific exceptions while still logging real bugs."""

    def setUp(self) -> None:
        self.server, _port, shutdown = start_server(port=0)
        self.addCleanup(shutdown)

    def _drive(self, exc: BaseException) -> str:
        with mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
            try:
                raise exc
            except type(exc):
                self.server.handle_error(None, ("127.0.0.1", 12345))
            return stderr.getvalue()

    def test_broken_pipe_is_silent(self) -> None:
        self.assertEqual(self._drive(BrokenPipeError(32, "broken pipe")), "")

    def test_connection_reset_is_silent(self) -> None:
        self.assertEqual(self._drive(ConnectionResetError(54, "reset")), "")

    def test_connection_aborted_is_silent(self) -> None:
        self.assertEqual(
            self._drive(ConnectionAbortedError(53, "aborted")), ""
        )

    def test_real_errors_still_log(self) -> None:
        out = self._drive(RuntimeError("kaboom"))
        self.assertIn("RuntimeError", out)
        self.assertIn("kaboom", out)


class StreamEventsHelperTests(unittest.TestCase):
    """Unit tests for the server's NDJSON streaming primitive.

    Tested with a stub handler whose `wfile` is a BytesIO so we can
    inspect the exact wire bytes without spinning up a real server."""

    def _make_handler(self, accept_encoding: str = "gzip") -> object:
        class _Stub:
            def __init__(self):
                self.wfile = io.BytesIO()
                self.headers = {"Accept-Encoding": accept_encoding}
                self._sent_status: int | None = None
                self._sent_headers: list[tuple[str, str]] = []
                self._ended = False

            def send_response(self, code: int) -> None:
                self._sent_status = code

            def send_header(self, k: str, v: str) -> None:
                self._sent_headers.append((k, v))

            def end_headers(self) -> None:
                self._ended = True

        return _Stub()

    def test_writes_ndjson_lines(self) -> None:
        h = self._make_handler(accept_encoding="identity")
        _stream_events(h, [
            {"phase": "skeleton", "manifest": {"x": 1}},
            {"phase": "final", "manifest": {"x": 2}},
        ], threading.Event())
        # identity encoding — wire bytes are plain JSON-lines.
        lines = h.wfile.getvalue().decode("utf-8").splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(json.loads(lines[0])["phase"], "skeleton")
        self.assertEqual(json.loads(lines[1])["phase"], "final")

    def test_sends_correct_headers(self) -> None:
        h = self._make_handler(accept_encoding="gzip, deflate")
        _stream_events(h, [{"phase": "final", "manifest": {}}], threading.Event())
        self.assertEqual(h._sent_status, 200)
        header_dict = dict(h._sent_headers)
        self.assertEqual(header_dict.get("Content-Type"), "application/x-ndjson")
        self.assertEqual(header_dict.get("Content-Encoding"), "gzip")
        # No Content-Length — chunked.
        self.assertNotIn("Content-Length", header_dict)

    def test_gzip_round_trip(self) -> None:
        h = self._make_handler(accept_encoding="gzip")
        _stream_events(h, [{"phase": "final", "manifest": {"k": "v"}}], threading.Event())
        decompressed = gzip.decompress(h.wfile.getvalue())
        line = decompressed.decode("utf-8").strip()
        self.assertEqual(json.loads(line)["manifest"], {"k": "v"})

    def test_broken_pipe_sets_cancel_event(self) -> None:
        h = self._make_handler(accept_encoding="identity")
        # Replace wfile with one that raises on write.
        class _Broken:
            def write(self, _b): raise BrokenPipeError(32, "broken")
            def flush(self): pass
        h.wfile = _Broken()
        ev = threading.Event()
        with self.assertRaises(BrokenPipeError):
            _stream_events(h, [{"phase": "final", "manifest": {}}], ev)
        self.assertTrue(ev.is_set())

    def test_gzip_flushes_between_events(self) -> None:
        """Regression: GzipFile.write() buffers internally. Without an
        explicit flush between events, the skeleton bytes wouldn't reach
        the wire until the final event closes the stream. This test
        decompresses what's in the buffer AFTER the first event but
        BEFORE the second event finishes — that bytestream must contain
        the first event's JSON."""
        h = self._make_handler(accept_encoding="gzip")
        snapshots: list[bytes] = []

        def _events():
            yield {"phase": "skeleton", "manifest": {"x": 1}}
            # Snapshot the wire bytes BEFORE the final event is written.
            snapshots.append(h.wfile.getvalue())
            yield {"phase": "final", "manifest": {"x": 2}}

        _stream_events(h, _events(), threading.Event())
        # Decompress the snapshot. With Z_SYNC_FLUSH, the partial gzip
        # stream is decodable up to the sync marker.
        # Strip the gzip header (10 bytes) and feed raw DEFLATE to a
        # decompressor. Z_SYNC_FLUSH means each flushed block is
        # self-contained DEFLATE, so this works.
        decomp = zlib.decompressobj(wbits=-zlib.MAX_WBITS)
        partial = decomp.decompress(snapshots[0][10:])
        self.assertIn(b'"skeleton"', partial,
                      "skeleton event must reach wire before final event")

    def test_close_time_broken_pipe_sets_cancel_event(self) -> None:
        """If the broken pipe surfaces only at gzip-close time (common in
        practice — gzip buffers most writes), cancel_event must still be
        set so the surrounding scan thread stops.

        Note: ``GzipFile.close()`` doesn't propagate to
        ``fileobj.close()``; the real close-time failure mode is the
        trailer ``write()`` call. We simulate that here by making writes
        succeed during the event loop (and during the per-event
        ``gz.flush()`` sync blocks) but fail once the loop has exited —
        i.e. when GzipFile writes its 8-byte trailer."""
        h = self._make_handler(accept_encoding="gzip")

        class _TrailerFails:
            def __init__(self) -> None:
                self._written: bytes = b""
                self._loop_done: bool = False

            def write(self, b: bytes) -> int:
                if self._loop_done:
                    raise BrokenPipeError(32, "broken at close")
                self._written += b
                return len(b)

            def flush(self) -> None:
                pass

        stub = _TrailerFails()
        h.wfile = stub

        def _events():
            try:
                yield {"phase": "final", "manifest": {}}
            finally:
                # Generator finally fires when the for-loop in
                # _stream_events exhausts it (next() → StopIteration),
                # which happens before gz.close() writes the trailer.
                stub._loop_done = True

        ev = threading.Event()
        # Event writes + per-boundary flush succeed; the gzip trailer
        # write in finally raises BrokenPipeError, which the finally
        # block must swallow AND propagate to cancel_event.
        _stream_events(h, _events(), ev)
        self.assertTrue(ev.is_set(),
                        "close-time BrokenPipe must set cancel_event")


class DisconnectWatchdogTests(unittest.TestCase):
    """The watchdog is a daemon thread that polls a connection for
    EOF and trips a cancel event. Tested against a real socketpair
    so we can close one end and observe the watchdog's reaction."""

    def test_sets_event_on_client_close(self) -> None:
        srv, cli = socket.socketpair()
        self.addCleanup(srv.close)
        self.addCleanup(cli.close)

        class _Handler:
            def __init__(self, s):
                self.connection = s

        ev = threading.Event()
        t = _start_disconnect_watchdog(_Handler(srv), ev)
        # Client closes its end → server-side select wakes,
        # MSG_PEEK returns 0 bytes, watchdog sets the event.
        cli.close()
        self.assertTrue(ev.wait(timeout=2.0), "watchdog should set event within 2s")
        t.join(timeout=1.0)
        self.assertFalse(t.is_alive())

    def test_exits_when_event_set_externally(self) -> None:
        srv, cli = socket.socketpair()
        self.addCleanup(srv.close)
        self.addCleanup(cli.close)

        class _Handler:
            def __init__(self, s):
                self.connection = s

        ev = threading.Event()
        t = _start_disconnect_watchdog(_Handler(srv), ev)
        # Normal scan finish path: caller signals event; watchdog
        # observes it next poll cycle and exits cleanly.
        ev.set()
        t.join(timeout=2.0)
        self.assertFalse(t.is_alive())


class ManifestStreamTests(unittest.TestCase):
    """End-to-end /api/manifest tests for the NDJSON streaming
    behavior and the disk-cache lifecycle."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(
        self, redirect_cache_root, init_git_repo, http_helpers,
    ) -> None:
        self.cache_root = redirect_cache_root
        self._init_git_repo = init_git_repo
        self._http = http_helpers

    def setUp(self) -> None:
        super().setUp()
        self.server, self.server_port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)

    def _make_tiny_repo(self, td: str) -> None:
        # Init as a git working tree — the API now requires every local
        # scan target to be inside one. Files are left untracked here;
        # tests that need them to appear under the default
        # (tracked-only) scan should commit them explicitly. Tests that
        # only assert on event ordering / headers don't care.
        self._init_git_repo(Path(td))
        (Path(td) / "a.py").write_text("x = 1\n")
        (Path(td) / "b.py").write_text("y = 2\ny = 3\n")

    def test_cold_cache_emits_skeleton_then_final(self) -> None:
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}",
            )
        self.assertEqual(status, 200)
        # Local sources stream: scanning → skeleton → final. The
        # scanning marker is a phase-only event with no manifest.
        manifest_events = [e for e in events if "manifest" in e]
        self.assertEqual(len(manifest_events), 2)
        self.assertEqual(manifest_events[0]["phase"], "skeleton")
        self.assertEqual(manifest_events[1]["phase"], "final")

    def test_warm_cache_emits_one_final(self) -> None:
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            # Warm the cache.
            self._http.request_stream(self.server_port, f"/api/manifest?src={td}")
            # Second hit should be a single-final response.
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}",
            )
        self.assertEqual(status, 200)
        manifest_events = [e for e in events if "manifest" in e]
        self.assertEqual(len(manifest_events), 1)
        self.assertEqual(manifest_events[0]["phase"], "final")

    def test_no_cache_skips_lookup_and_save(self) -> None:
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            # Warm the cache first.
            self._http.request_stream(self.server_port, f"/api/manifest?src={td}")
            # no_cache=true should NOT serve from cache.
            _, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}&no_cache=true",
            )
            manifest_events = [e for e in events if "manifest" in e]
            self.assertEqual(
                len(manifest_events), 2, "no_cache should force a fresh scan",
            )
            # Delete the cache file and verify no_cache also skipped
            # the save — the cache should remain absent after this
            # request.
            import shutil
            shutil.rmtree(self.cache_root, ignore_errors=True)
            self.cache_root.mkdir(parents=True, exist_ok=True)
            self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}&no_cache=true",
            )
            manifests_dir = self.cache_root / "manifests"
            if manifests_dir.exists():
                self.assertEqual(
                    list(manifests_dir.iterdir()), [],
                    "no_cache=true must not write to the manifest cache",
                )

    def test_skeleton_has_placeholder_lines(self) -> None:
        import subprocess
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            # Default scan filters untracked files — commit a.py/b.py so
            # they appear in the manifest tree the test inspects below.
            for cmd in (
                ["git", "-C", td, "config", "user.email", "t@t"],
                ["git", "-C", td, "config", "user.name", "t"],
                ["git", "-C", td, "add", "a.py", "b.py"],
                ["git", "-C", td, "commit", "-q", "-m", "init"],
            ):
                subprocess.run(cmd, check=True)
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}",
            )
        manifest_events = [e for e in events if "manifest" in e]
        skeleton_tree = manifest_events[0]["manifest"]["tree"]
        final_tree = manifest_events[1]["manifest"]["tree"]

        def files(node):
            for child in node["children"]:
                if child["type"] == "file":
                    yield child
                else:
                    yield from files(child)

        skeleton_files = {f["name"]: f for f in files(skeleton_tree)}
        final_files = {f["name"]: f for f in files(final_tree)}

        # b.py has 2 real lines; skeleton should still report 1.
        self.assertEqual(skeleton_files["b.py"]["lines"], 1,
                         "skeleton must use placeholder lines=1, not real count")
        self.assertEqual(final_files["b.py"]["lines"], 2,
                         "final must report real line count")
        # Every skeleton file should be lines=1 (sanity check).
        for f in skeleton_files.values():
            self.assertEqual(f["lines"], 1)

    def test_mid_stream_error_emits_error_event(self) -> None:
        """If scan_tree_streaming raises unexpectedly after the skeleton
        has emitted, the server emits a {phase:'error'} event so the
        client gets a clean message, not a truncated stream."""
        from unittest.mock import patch
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            # Patch _populate_file_metadata to blow up. The skeleton has
            # already been yielded by the time this runs, so we exercise
            # the mid-stream-error path specifically.
            with patch("api.scan._populate_file_metadata") as mock_pop:
                mock_pop.side_effect = RuntimeError("disk on fire")
                status, events = self._http.request_stream(
                    self.server_port, f"/api/manifest?src={td}",
                )
        self.assertEqual(status, 200)
        # Expect: skeleton + error (or just error if the skeleton
        # boundary check fires first — either is acceptable).
        error_events = [e for e in events if e.get("phase") == "error"]
        self.assertEqual(len(error_events), 1)
        self.assertIn("disk on fire", error_events[0]["error"])

    def test_response_headers(self) -> None:
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            url = f"http://127.0.0.1:{self.server_port}/api/manifest?src={td}"
            req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"})
            resp = urllib.request.urlopen(req)
            self.assertEqual(resp.headers.get("Content-Type"), "application/x-ndjson")
            self.assertEqual(resp.headers.get("Content-Encoding"), "gzip")
            self.assertIsNone(resp.headers.get("Content-Length"))
            resp.read()  # drain


class GitOnlyLocalPathTests(unittest.TestCase):
    """Per task 11c: codecity is git-aware, so local scan targets must be
    inside a git working tree. Non-git dirs and bare repos are rejected
    with a 400 + helpful message; git URLs are unaffected (the clone IS
    a working tree); cache-delete bypasses the check (purely hygienic)."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(
        self, redirect_cache_root, init_git_repo, http_helpers,
    ) -> None:
        self.cache_root = redirect_cache_root
        self._init_git_repo = init_git_repo
        self._http = http_helpers

    def setUp(self) -> None:
        super().setUp()
        self.server, self.server_port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.server_port}"

    def test_local_path_in_git_repo_accepted(self) -> None:
        """A path that IS a git working tree streams a manifest (200)."""
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            (Path(td) / "x.py").write_text("print('hi')\n")
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={td}",
            )
        self.assertEqual(status, HTTPStatus.OK)
        # Must reach a final event — the stream actually ran.
        self.assertTrue(any(e.get("phase") == "final" for e in events))

    def test_local_path_not_in_git_repo_rejected(self) -> None:
        """A plain directory (no git) → 400 with the helpful message."""
        with TemporaryDirectory() as td:
            (Path(td) / "x.py").write_text("print('hi')\n")
            status, body = self._http.request(
                self.server_port, f"/api/manifest?src={td}",
            )
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn("git working tree", body.get("error", ""))

    def test_local_path_bare_repo_rejected(self) -> None:
        """A bare git repo has no working tree, so it must be rejected."""
        with TemporaryDirectory() as parent:
            bare = Path(parent) / "bare.git"
            self._init_git_repo(bare, bare=True)
            status, body = self._http.request(
                self.server_port, f"/api/manifest?src={bare}",
            )
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn("git working tree", body.get("error", ""))

    def test_local_subdir_of_git_repo_accepted(self) -> None:
        """Subdirs inherit the working-tree property — must be accepted."""
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            sub = Path(td) / "src"
            sub.mkdir()
            (sub / "x.py").write_text("print('hi')\n")
            status, events = self._http.request_stream(
                self.server_port, f"/api/manifest?src={sub}",
            )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(any(e.get("phase") == "final" for e in events))

    def test_signature_endpoint_rejects_non_git_path(self) -> None:
        """_resolve_scan_target also gates the signature endpoint."""
        with TemporaryDirectory() as td:
            (Path(td) / "x.py").write_text("print('hi')\n")
            status, body = self._http.request(
                self.server_port, f"/api/manifest/signature?src={td}",
            )
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn("git working tree", body.get("error", ""))

    def test_delete_cache_bypasses_git_check(self) -> None:
        """Cache deletion is hygienic — it must NOT require a git repo,
        so a user can clean up a recents entry whose path was removed
        or was never a git project."""
        with TemporaryDirectory() as td:
            # No git init — pure non-git directory.
            url = (
                f"http://127.0.0.1:{self.server_port}/api/manifest/cache"
                f"?src={td}"
            )
            status, body = self._http.delete(url)
        self.assertEqual(status, HTTPStatus.OK)
        # Zero entries (nothing was cached), but the operation itself
        # succeeded — that's the contract.
        self.assertEqual(body, {"deleted": 0})


class IsGitWorkingTreeHelperTests(unittest.TestCase):
    """Direct unit tests for the helper that the server endpoints call."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(self, init_git_repo) -> None:
        self._init_git_repo = init_git_repo

    def test_returns_true_for_working_tree(self) -> None:
        from api.server import _is_git_working_tree
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            self.assertTrue(_is_git_working_tree(Path(td)))

    def test_returns_true_for_subdir_of_working_tree(self) -> None:
        from api.server import _is_git_working_tree
        with TemporaryDirectory() as td:
            self._init_git_repo(Path(td))
            sub = Path(td) / "nested"
            sub.mkdir()
            self.assertTrue(_is_git_working_tree(sub))

    def test_returns_false_for_non_git_directory(self) -> None:
        from api.server import _is_git_working_tree
        with TemporaryDirectory() as td:
            self.assertFalse(_is_git_working_tree(Path(td)))

    def test_returns_false_for_bare_repo(self) -> None:
        from api.server import _is_git_working_tree
        with TemporaryDirectory() as parent:
            bare = Path(parent) / "bare.git"
            self._init_git_repo(bare, bare=True)
            self.assertFalse(_is_git_working_tree(bare))


if __name__ == "__main__":
    unittest.main()
