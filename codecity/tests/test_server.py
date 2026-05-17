"""Tests for the local HTTP server."""

from __future__ import annotations

import gzip
import http.client
import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zlib
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from codecity import clone as clone_mod
from codecity import server as server_mod
from codecity.server import _classify_source, _stream_events, start_server
from codecity.tests.test_clone import _make_fake_remote


class _CacheRedirectMixin:
    """Mixin that redirects codecity.cache.CACHE_ROOT to a per-test
    tempdir so server-side calls into scan_tree() / signature_tree()
    don't pollute the user's actual ~/.cache/codecity/ during tests."""

    def setUp(self) -> None:
        super().setUp()  # cooperative chaining
        from codecity import cache as cache_mod
        self._cache_tmp = TemporaryDirectory()
        self.addCleanup(self._cache_tmp.cleanup)
        self._original_cache_root = cache_mod.CACHE_ROOT
        cache_mod.CACHE_ROOT = Path(self._cache_tmp.name)
        self.addCleanup(self._restore_cache_root)

    def _restore_cache_root(self) -> None:
        from codecity import cache as cache_mod
        cache_mod.CACHE_ROOT = self._original_cache_root


# Silence scan progress logs.
os.environ["CODECITY_QUIET"] = "1"


def _get(url: str) -> tuple[int, bytes, str]:
    """Issue a GET; return (status, body, content_type)."""
    try:
        resp = urllib.request.urlopen(url)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "")
    return resp.status, resp.read(), resp.headers.get("Content-Type", "")


def _request(port: int, path: str) -> tuple[int, dict]:
    """Issue a GET to the local server at *port*; return (status, parsed_json_body).

    path should start with '/' (e.g. '/api/manifest?src=…').
    Error responses (4xx/5xx) are parsed from the HTTPError body."""
    url = f"http://127.0.0.1:{port}{path}"
    try:
        resp = urllib.request.urlopen(url)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _get_with_headers(
    url: str, headers: dict[str, str],
) -> tuple[int, bytes, str, str]:
    """Issue a GET with custom request headers; return
    (status, body, content_type, content_encoding).

    The body is returned as-is (raw bytes). Tests that requested gzip
    are responsible for calling gzip.decompress themselves — that's the
    whole point of the verification."""
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


class ServerTests(_CacheRedirectMixin, unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()  # runs _CacheRedirectMixin.setUp -> redirects CACHE_ROOT
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        static = Path(self.tmp.name) / "static"
        static.mkdir()
        (static / "index.html").write_text("<html><body>hi</body></html>")
        (static / "assets").mkdir()
        (static / "assets" / "main.js").write_text("console.log('ok')")

        # A small directory we can scan in the manifest test.
        self.project = Path(self.tmp.name) / "project"
        self.project.mkdir()
        (self.project / "README.md").write_text("# demo\n")

        self.server, self.port, self.shutdown = start_server(port=0, static_dir=static)
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"

    def test_health_route(self) -> None:
        status, body, ctype = _get(self.base + "/api/health")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), {"ok": True})

    def test_manifest_route_scans_query_path(self) -> None:
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, body, ctype = _get(self.base + f"/api/manifest?{q}")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("application/json", ctype)
        payload = json.loads(body)
        self.assertEqual(payload["tree"]["name"], "project")
        self.assertIn("signature", payload)
        # Successful scan must register the root.
        self.assertIn(self.project.resolve(), server_mod._State.allowed_roots)

    def test_manifest_missing_query_returns_400(self) -> None:
        status, body, _ = _get(self.base + "/api/manifest")
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn("missing", json.loads(body)["error"])

    def test_manifest_nonexistent_path_returns_404(self) -> None:
        q = urllib.parse.urlencode({"src": str(self.project / "nope")})
        status, _, _ = _get(self.base + f"/api/manifest?{q}")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_signature_route_matches_manifest_signature(self) -> None:
        # The contract powering the cheap-poll: the signature endpoint
        # returns the same digest the full manifest would have produced.
        q = urllib.parse.urlencode({"src": str(self.project)})
        m_status, m_body, _ = _get(self.base + f"/api/manifest?{q}")
        s_status, s_body, s_ctype = _get(self.base + f"/api/manifest/signature?{q}")
        self.assertEqual(m_status, HTTPStatus.OK)
        self.assertEqual(s_status, HTTPStatus.OK)
        self.assertIn("application/json", s_ctype)
        manifest = json.loads(m_body)
        sig = json.loads(s_body)
        self.assertEqual(sig["signature"], manifest["signature"])
        # Lean shape — no tree / repo fields on the signature endpoint.
        self.assertNotIn("tree", sig)
        self.assertNotIn("repo", sig)

    def test_signature_route_missing_query_returns_400(self) -> None:
        status, _, _ = _get(self.base + "/api/manifest/signature")
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)

    def test_signature_route_nonexistent_path_returns_404(self) -> None:
        q = urllib.parse.urlencode({"src": str(self.project / "nope")})
        status, _, _ = _get(self.base + f"/api/manifest/signature?{q}")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_root_serves_index_html(self) -> None:
        status, body, ctype = _get(self.base + "/")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("text/html", ctype)
        self.assertIn(b"<body>hi</body>", body)

    def test_static_asset_with_correct_mime(self) -> None:
        status, body, ctype = _get(self.base + "/assets/main.js")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(
            ctype.startswith("text/javascript")
            or ctype.startswith("application/javascript")
        )
        self.assertEqual(body, b"console.log('ok')")

    def test_unknown_api_route_returns_404_json(self) -> None:
        status, body, ctype = _get(self.base + "/api/nope")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)
        self.assertIn("application/json", ctype)
        self.assertEqual(json.loads(body), {"error": "unknown api route"})

    def test_missing_static_returns_404(self) -> None:
        status, _, _ = _get(self.base + "/does-not-exist.html")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_path_traversal_rejected(self) -> None:
        # urllib normalizes ../ on the client side, so we go raw to make sure
        # the server itself rejects a crafted escape attempt.
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/../codecity/scan.py")
        resp = conn.getresponse()
        self.assertIn(resp.status, (HTTPStatus.FORBIDDEN, HTTPStatus.NOT_FOUND))

    def test_manifest_route_honors_include_all(self) -> None:
        # Add an untracked file by initializing the project as a git repo
        # and committing only README.md — anything else is "untracked",
        # which the default scan filters out.
        import subprocess
        subprocess.run(
            ["git", "-C", str(self.project), "init", "-q"], check=True
        )
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.email", "t@t"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.name", "t"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.project), "add", "README.md"], check=True
        )
        subprocess.run(
            ["git", "-C", str(self.project), "commit", "-q", "-m", "init"],
            check=True,
        )
        (self.project / "untracked.txt").write_text("hidden by default")

        q = urllib.parse.urlencode({"src": str(self.project)})
        _, body_default, _ = _get(self.base + f"/api/manifest?{q}")
        names_default = [
            c["name"] for c in json.loads(body_default)["tree"]["children"]
        ]
        self.assertNotIn("untracked.txt", names_default)

        q_all = urllib.parse.urlencode(
            {"src": str(self.project), "include_all": "true"}
        )
        _, body_all, _ = _get(self.base + f"/api/manifest?{q_all}")
        names_all = [c["name"] for c in json.loads(body_all)["tree"]["children"]]
        self.assertIn("untracked.txt", names_all)

    def test_signature_route_honors_include_all(self) -> None:
        # Reuses the project setup from the previous test — set up inline
        # so this test runs independently if the order changes.
        import subprocess
        subprocess.run(
            ["git", "-C", str(self.project), "init", "-q"], check=True
        )
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.email", "t@t"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.name", "t"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.project), "add", "README.md"], check=True
        )
        subprocess.run(
            ["git", "-C", str(self.project), "commit", "-q", "-m", "init"],
            check=True,
        )
        (self.project / "untracked.txt").write_text("hidden by default")

        q = urllib.parse.urlencode({"src": str(self.project)})
        _, body_default, _ = _get(self.base + f"/api/manifest/signature?{q}")
        sig_default = json.loads(body_default)["signature"]

        q_all = urllib.parse.urlencode(
            {"src": str(self.project), "include_all": "true"}
        )
        _, body_all, _ = _get(self.base + f"/api/manifest/signature?{q_all}")
        sig_all = json.loads(body_all)["signature"]

        self.assertNotEqual(sig_default, sig_all)

    def test_include_all_truthy_parsing(self) -> None:
        # Accept 'true' (any case) and '1' as truthy; everything else
        # (including absent) is false.
        from codecity.server import _parse_include_all
        self.assertTrue(_parse_include_all("include_all=true"))
        self.assertTrue(_parse_include_all("include_all=TRUE"))
        self.assertTrue(_parse_include_all("include_all=1"))
        self.assertFalse(_parse_include_all("include_all=false"))
        self.assertFalse(_parse_include_all("include_all=0"))
        self.assertFalse(_parse_include_all("include_all=yes"))  # strict
        self.assertFalse(_parse_include_all(""))
        self.assertFalse(_parse_include_all("path=/tmp"))

    def test_manifest_route_excludes_skip_list_under_include_all(self) -> None:
        # Init a git repo, create node_modules/, commit ONLY README.
        # node_modules is untracked, so it would appear with include_all
        # if not for ALWAYS_SKIP. The skip list is always applied —
        # there's no runtime escape hatch.
        import subprocess
        subprocess.run(
            ["git", "-C", str(self.project), "init", "-q"], check=True
        )
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.email", "t@t"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.project), "config", "user.name", "t"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.project), "add", "README.md"], check=True
        )
        subprocess.run(
            ["git", "-C", str(self.project), "commit", "-q", "-m", "init"],
            check=True,
        )
        nm = self.project / "node_modules"
        nm.mkdir()
        (nm / "x.js").write_text("x")

        q = urllib.parse.urlencode({
            "src": str(self.project), "include_all": "true",
        })
        _, body, _ = _get(self.base + f"/api/manifest?{q}")
        names = [c["name"] for c in json.loads(body)["tree"]["children"]]
        self.assertNotIn("node_modules", names)

    def test_no_cache_query_param_truthy_parsing(self) -> None:
        from codecity.server import _parse_no_cache
        self.assertTrue(_parse_no_cache("no_cache=true"))
        self.assertTrue(_parse_no_cache("no_cache=TRUE"))
        self.assertTrue(_parse_no_cache("no_cache=1"))
        self.assertFalse(_parse_no_cache("no_cache=false"))
        self.assertFalse(_parse_no_cache("no_cache=0"))
        self.assertFalse(_parse_no_cache(""))
        self.assertFalse(_parse_no_cache("path=/tmp"))

    def test_manifest_response_gzipped_when_requested(self) -> None:
        # Client advertises gzip; server compresses; decompressed body
        # parses as the same JSON the uncompressed path would return.
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, body, ctype, enc = _get_with_headers(
            self.base + f"/api/manifest?{q}",
            {"Accept-Encoding": "gzip"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "gzip")
        self.assertIn("application/json", ctype)
        decoded = gzip.decompress(body)
        payload = json.loads(decoded)
        self.assertEqual(payload["tree"]["name"], "project")

    def test_manifest_response_uncompressed_without_accept_encoding(self) -> None:
        # No Accept-Encoding header at all -> no Content-Encoding,
        # body parses directly as JSON.
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, body, ctype, enc = _get_with_headers(
            self.base + f"/api/manifest?{q}", {},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        self.assertIn("application/json", ctype)
        payload = json.loads(body)
        self.assertEqual(payload["tree"]["name"], "project")

    def test_manifest_response_uncompressed_when_gzip_not_in_accept(self) -> None:
        # Client supports brotli but not gzip -> no compression.
        q = urllib.parse.urlencode({"src": str(self.project)})
        status, body, _, enc = _get_with_headers(
            self.base + f"/api/manifest?{q}",
            {"Accept-Encoding": "br"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        # Sanity: it's still valid JSON.
        json.loads(body)

    def test_health_response_below_threshold_uncompressed(self) -> None:
        # /api/health body is ~15 bytes — below the 256-byte threshold.
        # Even with gzip in Accept-Encoding, response is not compressed.
        status, body, _, enc = _get_with_headers(
            self.base + "/api/health",
            {"Accept-Encoding": "gzip"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        self.assertEqual(json.loads(body), {"ok": True})


class FileApiTests(_CacheRedirectMixin, unittest.TestCase):
    """Coverage for /api/file — the root-bounded file reader."""

    def setUp(self) -> None:
        super().setUp()  # runs _CacheRedirectMixin.setUp -> redirects CACHE_ROOT
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.scan_root = Path(self.tmp.name) / "project"
        self.scan_root.mkdir()

        # Inside-root files
        (self.scan_root / "hello.txt").write_text("hello world")
        (self.scan_root / "image.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
        sub = self.scan_root / "sub"
        sub.mkdir()
        (sub / "nested.md").write_text("# heading")

        # An outside-root file the server must refuse to expose
        self.outside = Path(self.tmp.name) / "secret.txt"
        self.outside.write_text("you can't see me")

        # Static dir is irrelevant to /api/file but required by start_server
        static = Path(self.tmp.name) / "static"
        static.mkdir()
        (static / "index.html").write_text("ok")

        self.server, self.port, self.shutdown = start_server(port=0, static_dir=static)
        self.addCleanup(self.shutdown)
        self.base = f"http://127.0.0.1:{self.port}"
        # Prime the trust set directly — we're unit-testing /api/file, not
        # the manifest path that normally registers the root.
        server_mod._State.allowed_roots.add(self.scan_root.resolve())

    def test_returns_text_with_correct_mime(self) -> None:
        status, body, ctype = _get(
            self.base + f"/api/file?path={self.scan_root / 'hello.txt'}"
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))
        self.assertEqual(body, b"hello world")

    def test_returns_image_with_correct_mime(self) -> None:
        status, body, ctype = _get(
            self.base + f"/api/file?path={self.scan_root / 'image.png'}"
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(ctype, "image/png")
        self.assertTrue(body.startswith(b"\x89PNG"))

    def test_nested_path_inside_root(self) -> None:
        status, _, _ = _get(
            self.base + f"/api/file?path={self.scan_root / 'sub' / 'nested.md'}"
        )
        self.assertEqual(status, HTTPStatus.OK)

    def test_path_outside_root_forbidden(self) -> None:
        status, body, _ = _get(self.base + f"/api/file?path={self.outside}")
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        self.assertEqual(json.loads(body), {"error": "outside scan root"})

    def test_missing_path_param(self) -> None:
        status, _, _ = _get(self.base + "/api/file")
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)

    def test_nonexistent_file(self) -> None:
        status, _, _ = _get(
            self.base + f"/api/file?path={self.scan_root / 'nope.txt'}"
        )
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_directory_is_not_a_file(self) -> None:
        status, _, _ = _get(self.base + f"/api/file?path={self.scan_root / 'sub'}")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_extensionless_textfile_returns_text(self) -> None:
        # LICENSE, Makefile, Dockerfile, .gitignore — mimetypes can't help.
        license_path = self.scan_root / "LICENSE"
        license_path.write_text("MIT License\n\nCopyright (c) ...")
        status, body, ctype = _get(self.base + f"/api/file?path={license_path}")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))
        self.assertIn(b"MIT License", body)

    def test_shell_script_returns_text_not_octet_stream(self) -> None:
        # mimetypes guesses .sh as 'application/x-sh' — neither media nor
        # text. We want shell scripts (and friends) shown as code.
        sh_path = self.scan_root / "build.sh"
        sh_path.write_text("#!/bin/bash\necho hi\n")
        status, body, ctype = _get(self.base + f"/api/file?path={sh_path}")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))
        self.assertIn(b"echo hi", body)

    def test_aggressive_text_rendering_for_unknown_binaries(self) -> None:
        # Even files that look binary get served as text/plain so the
        # frontend renders the bytes IDE-style. (Truly-binary content
        # decodes with replacement chars in the browser; that's fine.)
        bin_path = self.scan_root / "blob.dat"
        bin_path.write_bytes(b"\x00\x01\x02\x03" * 200)
        status, _, ctype = _get(self.base + f"/api/file?path={bin_path}")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))

    def test_file_api_text_gzipped(self) -> None:
        # A text file (>256 bytes) requested with Accept-Encoding: gzip
        # comes back compressed.
        big_text = self.scan_root / "big.md"
        big_text.write_text("# heading\n\n" + ("hello world\n" * 100))
        status, body, ctype, enc = _get_with_headers(
            self.base + f"/api/file?path={big_text}",
            {"Accept-Encoding": "gzip"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "gzip")
        self.assertTrue(ctype.startswith("text/"))
        decoded = gzip.decompress(body)
        self.assertIn(b"hello world", decoded)

    def test_file_api_image_not_gzipped(self) -> None:
        # Already-compressed media bypasses gzip even when client offers it.
        # Use a >256-byte fake PNG so the size threshold isn't doing the work.
        png_path = self.scan_root / "big-image.png"
        png_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 500)
        status, body, ctype, enc = _get_with_headers(
            self.base + f"/api/file?path={png_path}",
            {"Accept-Encoding": "gzip"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        self.assertEqual(ctype, "image/png")
        # Body is the raw "PNG" bytes — not gzipped.
        self.assertTrue(body.startswith(b"\x89PNG"))


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

    def setUp(self) -> None:
        self.server, self.server_port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)

    def test_local_path_ok(self) -> None:
        with TemporaryDirectory() as td:
            (Path(td) / "x.py").write_text("print('hi')\n")
            status, body = _request(self.server_port, f"/api/manifest?src={td}")
            self.assertEqual(status, 200)
            # resolve() follows macOS /var -> /private/var symlinks; the
            # manifest's root field reflects the real resolved path.
            self.assertEqual(body.get("root"), str(Path(td).resolve()))

    def test_local_path_with_branch_silently_ignored(self) -> None:
        with TemporaryDirectory() as td:
            (Path(td) / "x.py").write_text("print('hi')\n")
            status, body = _request(self.server_port, f"/api/manifest?src={td}&branch=main")
            self.assertEqual(status, 200)
            # display_root not set for in-place local scan
            self.assertNotIn("display_root", body)

    def test_invalid_source(self) -> None:
        status, body = _request(self.server_port, "/api/manifest?src=garbage")
        self.assertEqual(status, 400)
        self.assertIn("unrecognized source", body.get("error", "").lower())

    def test_missing_src(self) -> None:
        status, body = _request(self.server_port, "/api/manifest")
        self.assertEqual(status, 400)
        self.assertIn("'src'", body.get("error", ""))

    def test_old_path_param_rejected(self) -> None:
        # ?path= is no longer recognized — server should 400 missing 'src'.
        with TemporaryDirectory() as td:
            status, body = _request(self.server_port, f"/api/manifest?path={td}")
            self.assertEqual(status, 400)
            self.assertIn("'src'", body.get("error", ""))

    def test_nonexistent_path(self) -> None:
        status, body = _request(self.server_port, "/api/manifest?src=/this/does/not/exist/xyzzy")
        self.assertEqual(status, 404)
        self.assertIn("path not found", body.get("error", ""))

    def test_path_is_file_not_directory(self) -> None:
        with TemporaryDirectory() as td:
            f = Path(td) / "afile.txt"
            f.write_text("hi")
            status, body = _request(self.server_port, f"/api/manifest?src={f}")
            self.assertEqual(status, 400)
            self.assertIn("not a directory", body.get("error", ""))


class DisplayRootTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server, self.server_port, self.shutdown = start_server(port=0)
        self.addCleanup(self.shutdown)

    def test_local_src_no_display_root(self) -> None:
        with TemporaryDirectory() as td:
            (Path(td) / "x.py").write_text("\n")
            status, body = _request(self.server_port, f"/api/manifest?src={td}")
            self.assertEqual(status, 200)
            self.assertNotIn("display_root", body)

    def test_git_url_sets_display_root(self) -> None:
        # Use a local bare repo so we don't hit the network.
        with TemporaryDirectory() as td:
            remote, _ = _make_fake_remote(Path(td))
            # Use a file:// URL so _classify_source returns 'git'.
            url = f"file://{remote}"
            # Monkey-patch CACHE_ROOT so we don't pollute ~/.cache.
            with mock.patch.object(clone_mod, "CACHE_ROOT", Path(td) / "cache"):
                status, body = _request(self.server_port, f"/api/manifest?src={url}")
            self.assertEqual(status, 200)
            self.assertEqual(body.get("display_root"), url)

    def test_git_url_with_branch_appends_at_branch(self) -> None:
        with TemporaryDirectory() as td:
            remote, _ = _make_fake_remote(Path(td))
            url = f"file://{remote}"
            with mock.patch.object(clone_mod, "CACHE_ROOT", Path(td) / "cache"):
                status, body = _request(
                    self.server_port, f"/api/manifest?src={url}&branch=feature"
                )
            self.assertEqual(status, 200)
            self.assertEqual(body.get("display_root"), f"{url}@feature")


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


if __name__ == "__main__":
    unittest.main()
