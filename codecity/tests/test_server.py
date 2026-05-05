"""Tests for the local HTTP server."""

from __future__ import annotations

import http.client
import json
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory

from codecity import server as server_mod
from codecity.server import start_server


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
        q = urllib.parse.urlencode({"path": str(self.project)})
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

    def test_manifest_both_path_and_clone_returns_400(self) -> None:
        q = urllib.parse.urlencode({"path": str(self.project), "clone": "x"})
        status, _, _ = _get(self.base + f"/api/manifest?{q}")
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)

    def test_manifest_nonexistent_path_returns_404(self) -> None:
        q = urllib.parse.urlencode({"path": str(self.project / "nope")})
        status, _, _ = _get(self.base + f"/api/manifest?{q}")
        self.assertEqual(status, HTTPStatus.NOT_FOUND)

    def test_signature_route_matches_manifest_signature(self) -> None:
        # The contract powering the cheap-poll: the signature endpoint
        # returns the same digest the full manifest would have produced.
        q = urllib.parse.urlencode({"path": str(self.project)})
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
        q = urllib.parse.urlencode({"path": str(self.project / "nope")})
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

        q = urllib.parse.urlencode({"path": str(self.project)})
        _, body_default, _ = _get(self.base + f"/api/manifest?{q}")
        names_default = [
            c["name"] for c in json.loads(body_default)["tree"]["children"]
        ]
        self.assertNotIn("untracked.txt", names_default)

        q_all = urllib.parse.urlencode(
            {"path": str(self.project), "include_all": "true"}
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

        q = urllib.parse.urlencode({"path": str(self.project)})
        _, body_default, _ = _get(self.base + f"/api/manifest/signature?{q}")
        sig_default = json.loads(body_default)["signature"]

        q_all = urllib.parse.urlencode(
            {"path": str(self.project), "include_all": "true"}
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

    def test_manifest_route_honors_no_skip_list(self) -> None:
        # Init a git repo, create node_modules/foo, commit ONLY README.
        # node_modules is untracked, so it appears only with include_all.
        # With include_all=true alone, the skip list excludes it. With
        # include_all=true&no_skip_list=true, it's included.
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

        q_skipped = urllib.parse.urlencode({
            "path": str(self.project), "include_all": "true",
        })
        _, body_skipped, _ = _get(self.base + f"/api/manifest?{q_skipped}")
        names_skipped = [
            c["name"] for c in json.loads(body_skipped)["tree"]["children"]
        ]
        self.assertNotIn("node_modules", names_skipped)

        q_full = urllib.parse.urlencode({
            "path": str(self.project),
            "include_all": "true",
            "no_skip_list": "true",
        })
        _, body_full, _ = _get(self.base + f"/api/manifest?{q_full}")
        names_full = [
            c["name"] for c in json.loads(body_full)["tree"]["children"]
        ]
        self.assertIn("node_modules", names_full)

    def test_no_cache_query_param_truthy_parsing(self) -> None:
        from codecity.server import _parse_no_cache
        self.assertTrue(_parse_no_cache("no_cache=true"))
        self.assertTrue(_parse_no_cache("no_cache=TRUE"))
        self.assertTrue(_parse_no_cache("no_cache=1"))
        self.assertFalse(_parse_no_cache("no_cache=false"))
        self.assertFalse(_parse_no_cache("no_cache=0"))
        self.assertFalse(_parse_no_cache(""))
        self.assertFalse(_parse_no_cache("path=/tmp"))

    def test_no_skip_list_query_param_truthy_parsing(self) -> None:
        from codecity.server import _parse_no_skip_list
        self.assertTrue(_parse_no_skip_list("no_skip_list=true"))
        self.assertTrue(_parse_no_skip_list("no_skip_list=1"))
        self.assertFalse(_parse_no_skip_list("no_skip_list=false"))
        self.assertFalse(_parse_no_skip_list("no_skip_list=yes"))
        self.assertFalse(_parse_no_skip_list(""))


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


if __name__ == "__main__":
    unittest.main()
