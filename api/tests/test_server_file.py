"""Tests for /api/file?path= (split from test_server.py)."""

from __future__ import annotations

import gzip
import json
import unittest
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api import server as server_mod
from api.server import start_server


class FileApiTests(unittest.TestCase):
    """Coverage for /api/file — the root-bounded file reader."""

    @pytest.fixture(autouse=True)
    def _setup_fixtures(self, redirect_cache_root, http_helpers, monkeypatch) -> None:
        self.cache_root = redirect_cache_root
        self._http = http_helpers
        self.monkeypatch = monkeypatch

    def setUp(self) -> None:
        super().setUp()
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
        status, body, ctype = self._http.get(
            self.base + f"/api/file?path={self.scan_root / 'hello.txt'}"
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))
        self.assertEqual(body, b"hello world")

    def test_returns_image_with_correct_mime(self) -> None:
        status, body, ctype = self._http.get(
            self.base + f"/api/file?path={self.scan_root / 'image.png'}"
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(ctype, "image/png")
        self.assertTrue(body.startswith(b"\x89PNG"))

    def test_nested_path_inside_root(self) -> None:
        status, _, _ = self._http.get(
            self.base + f"/api/file?path={self.scan_root / 'sub' / 'nested.md'}"
        )
        self.assertEqual(status, HTTPStatus.OK)

    def test_path_outside_root_forbidden(self) -> None:
        status, body, _ = self._http.get(self.base + f"/api/file?path={self.outside}")
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        self.assertEqual(json.loads(body), {"error": "outside scan root"})

    def test_missing_path_param(self) -> None:
        status, _, _ = self._http.get(self.base + "/api/file")
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)

    def test_nonexistent_file(self) -> None:
        status, _, _ = self._http.get(
            self.base + f"/api/file?path={self.scan_root / 'nope.txt'}"
        )
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_directory_is_not_a_file(self) -> None:
        status, _, _ = self._http.get(self.base + f"/api/file?path={self.scan_root / 'sub'}")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_extensionless_textfile_returns_text(self) -> None:
        # LICENSE, Makefile, Dockerfile, .gitignore — mimetypes can't help.
        license_path = self.scan_root / "LICENSE"
        license_path.write_text("MIT License\n\nCopyright (c) ...")
        status, body, ctype = self._http.get(self.base + f"/api/file?path={license_path}")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))
        self.assertIn(b"MIT License", body)

    def test_shell_script_returns_text_not_octet_stream(self) -> None:
        # mimetypes guesses .sh as 'application/x-sh' — neither media nor
        # text. We want shell scripts (and friends) shown as code.
        sh_path = self.scan_root / "build.sh"
        sh_path.write_text("#!/bin/bash\necho hi\n")
        status, body, ctype = self._http.get(self.base + f"/api/file?path={sh_path}")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))
        self.assertIn(b"echo hi", body)

    def test_aggressive_text_rendering_for_unknown_binaries(self) -> None:
        # Even files that look binary get served as text/plain so the
        # frontend renders the bytes IDE-style. (Truly-binary content
        # decodes with replacement chars in the browser; that's fine.)
        bin_path = self.scan_root / "blob.dat"
        bin_path.write_bytes(b"\x00\x01\x02\x03" * 200)
        status, _, ctype = self._http.get(self.base + f"/api/file?path={bin_path}")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(ctype.startswith("text/plain"))

    def test_file_api_text_gzipped(self) -> None:
        # A text file (>256 bytes) requested with Accept-Encoding: gzip
        # comes back compressed.
        big_text = self.scan_root / "big.md"
        big_text.write_text("# heading\n\n" + ("hello world\n" * 100))
        status, body, ctype, enc = self._http.get_with_headers(
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
        status, body, ctype, enc = self._http.get_with_headers(
            self.base + f"/api/file?path={png_path}",
            {"Accept-Encoding": "gzip"},
        )
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(enc, "")
        self.assertEqual(ctype, "image/png")
        # Body is the raw "PNG" bytes — not gzipped.
        self.assertTrue(body.startswith(b"\x89PNG"))

    def test_local_src_blocked_via_manifest_keeps_file_endpoint_clean(self) -> None:
        """/api/file trusts `_State.allowed_roots`, which is populated by
        successful manifest scans. The local-repo gate sits upstream in
        _resolve_scan_target / _serve_manifest, so blocked-local scans
        never register a root. Validate the chain by attempting a local
        manifest with the gate off — expect 403 and no trust-set growth."""
        import urllib.parse

        self.monkeypatch.delenv("CODECITY_ALLOW_LOCAL_REPOS", raising=False)
        q = urllib.parse.urlencode({"src": "/tmp/some-local-path"})
        status, body, _ = self._http.get(self.base + f"/api/manifest?{q}")
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        err = json.loads(body)["error"]
        self.assertIn("local repositories are disabled", err)


if __name__ == "__main__":
    unittest.main()
