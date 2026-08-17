"""Per-file metadata: extensions, binary sniffing, line counts, the file cache,
and the media dimensions a scan stamps onto nodes."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import pytest

from api.scan.filemeta import extension, is_binary
from api.utils.content import count_lines_at as line_count
from api.utils.content import BINARY_CHUNK, is_binary_bytes
from api.tests.conftest import (
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
    walk_files,
)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("index.ts", ".ts"),
        ("index.test.ts", ".ts"),
        # A dotfile's leading dot does not open an extension.
        (".gitignore", ""),
        (".env", ""),
        (".env.local", ".local"),
        ("Makefile", ""),
    ],
)
def test_extension(name, expected):
    assert extension(name) == expected


# The heuristic is pure and public (utils.content.is_binary_bytes); _is_binary only
# adds the read. Classification is tested against bytes, with no filesystem.
@pytest.mark.parametrize(
    ("label", "content", "expected"),
    [
        ("plain text", b"hello world\nline two\n", False),
        ("a null byte anywhere", b"hello\x00world", True),
        ("empty", b"", False),
        ("control bytes outside the text set", bytes(range(1, 7)) * 40, True),
    ],
)
def test_is_binary_bytes(label, content, expected):
    assert is_binary_bytes(content) is expected


def test_is_binary_reads_only_the_first_chunk():
    handle = mock.mock_open(read_data=b"\x00" * 10)
    path = mock.Mock(spec=Path)
    path.open.return_value = handle.return_value

    assert is_binary(path) is True
    path.open.assert_called_once_with("rb")
    handle.return_value.read.assert_called_once_with(BINARY_CHUNK)


def test_is_binary_treats_an_unreadable_file_as_binary():
    """Fail safe: a file we cannot read must not be fed to the line counter."""
    path = mock.Mock(spec=Path)
    path.open.side_effect = OSError("permission denied")
    assert is_binary(path) is True


class LineCountTests(unittest.TestCase):
    """Counts are exact at every size. They were sampled above ~5 MB once, and
    the estimate is what these assertions used to allow for."""

    def test_exact_count_on_a_small_file(self):
        with tempfile.NamedTemporaryFile("wb", delete=False) as fh:
            fh.write(b"line\n" * 1000)
            small = Path(fh.name)
        self.addCleanup(small.unlink, missing_ok=True)
        self.assertEqual(line_count(small), 1000)

    def test_exact_count_past_the_old_sampling_threshold(self):
        # 6 MB, one newline every 50 bytes: exactly 125,829 lines, and the
        # counter reads it in chunks rather than loading it whole.
        lines = 6 * 1024 * 1024 // 50
        with tempfile.NamedTemporaryFile("wb", delete=False) as fh:
            fh.write((b"x" * 49 + b"\n") * lines)
            big = Path(fh.name)
        self.addCleanup(big.unlink, missing_ok=True)
        self.assertEqual(line_count(big), lines)

    def test_final_line_without_trailing_newline_counts(self):
        # Lines, not terminators. A minified file is one long line with no
        # trailing newline, which a terminator count reports as 0.

        def count(content: bytes) -> int:
            with tempfile.NamedTemporaryFile("wb", delete=False) as fh:
                fh.write(content)
                p = Path(fh.name)
            self.addCleanup(p.unlink, missing_ok=True)
            return line_count(p)

        self.assertEqual(count(b"one line, no newline"), 1)  # was 0
        self.assertEqual(count(b"a\nb\nc"), 3)  # final unterminated line counts
        self.assertEqual(count(b"a\nb\nc\n"), 3)  # trailing newline unchanged
        self.assertEqual(count(b""), 0)  # empty stays 0


def _line_count_real():
    """The unwrapped counter, for tests that mock the name filemeta calls while
    still wanting the real result."""
    from api.utils.content import count_lines_at

    return count_lines_at


class FileStatCacheTests(CacheRedirectMixin, unittest.TestCase):
    """Warm runs of scan_tree should hit the file-stat cache for
    unchanged files and skip is_binary + line_count entirely."""

    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_warm_run_skipsline_count(self):
        from unittest.mock import patch

        _final_manifest(str(FIXTURE))  # cold: populates cache

        with (
            patch("api.scan.filemeta.count_lines_at") as line_mock,
            patch("api.scan.filemeta.is_binary") as binary_mock,
        ):
            _final_manifest(str(FIXTURE))  # warm: should not call either
            self.assertEqual(
                line_mock.call_count, 0, "warm scan must not call line_count"
            )
            self.assertEqual(
                binary_mock.call_count, 0, "warm scan must not call _is_binary"
            )

    def test_warm_run_signature_matches_cold_run(self):
        cold = _final_manifest(str(FIXTURE))
        warm = _final_manifest(str(FIXTURE))
        self.assertEqual(cold.content_signature, warm.content_signature)
        # And tree shape — confirm `lines` survives the cache roundtrip.
        cold_lines = {n.path: n.lines for n in walk_files(cold.tree)}
        warm_lines = {n.path: n.lines for n in walk_files(warm.tree)}
        self.assertEqual(cold_lines, warm_lines)

    def test_modified_file_recomputed(self):
        from unittest.mock import patch

        _final_manifest(str(FIXTURE))  # populate

        # Change one file's mtime by writing to it.
        target = next(
            n
            for n in walk_files(_final_manifest(str(FIXTURE)).tree)
            if n.name == "index.ts"
        )
        target_path = Path(target.fullPath)
        original_text = target_path.read_text()
        target_path.write_text(original_text + "\n// changed\n")

        try:
            line_calls: list[Path] = []
            original_line_count = _line_count_real()

            def counting_line_count(p):
                line_calls.append(p)
                return original_line_count(p)

            with patch(
                "api.scan.filemeta.count_lines_at", side_effect=counting_line_count
            ):
                _final_manifest(str(FIXTURE))

            # Only the modified file should be recomputed.
            self.assertEqual(len(line_calls), 1)
            self.assertEqual(line_calls[0], target_path)
        finally:
            target_path.write_text(original_text)

    def test_use_cache_false_bypasses_file_cache(self):
        from unittest.mock import patch

        _final_manifest(str(FIXTURE))  # populate cache

        with patch("api.scan.filemeta.count_lines_at", return_value=42) as line_mock:
            _final_manifest(str(FIXTURE), use_cache=False)
            # use_cache=False -> every file gets re-read
            self.assertGreater(line_mock.call_count, 0)


class MediaDimsInScanTests(CacheRedirectMixin, unittest.TestCase):
    def test_scan_stamps_png_dimensions(self):
        import struct
        import zlib

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            init_repo(tmp_path)
            png = tmp_path / "pic.png"

            # Minimal 50x30 PNG.
            def chunk(tag, data):
                return (
                    struct.pack(">I", len(data))
                    + tag
                    + data
                    + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
                )

            sig = b"\x89PNG\r\n\x1a\n"
            ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 50, 30, 8, 2, 0, 0, 0))
            raw = (b"\x00" + b"\xff\x00\x00" * 50) * 30
            idat = chunk(b"IDAT", zlib.compress(raw))
            iend = chunk(b"IEND", b"")
            png.write_bytes(sig + ihdr + idat + iend)
            commit_all(tmp_path)

            manifest = _final_manifest(str(tmp_path))
            files = [c for c in manifest.tree.children if c.type == "file"]
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0].media_width, 50)
            self.assertEqual(files[0].media_height, 30)

            # The warm path stamps media dims from the cache, which is a
            # different branch from the cold read.
            manifest2 = _final_manifest(str(tmp_path))
            files2 = [c for c in manifest2.tree.children if c.type == "file"]
            self.assertEqual(len(files2), 1)
            self.assertEqual(files2[0].media_width, 50)
            self.assertEqual(files2[0].media_height, 30)

    def test_scan_omits_media_dims_for_non_media(self):
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            init_repo(tmp_path)
            (tmp_path / "code.py").write_text("print('hi')\n")
            commit_all(tmp_path)
            manifest = _final_manifest(str(tmp_path))
            files = [c for c in manifest.tree.children if c.type == "file"]
            self.assertEqual(len(files), 1)
            self.assertNotIn("media_width", files[0])
            self.assertNotIn("media_height", files[0])


def test_line_count_is_exact_not_sampled_over_5mb(tmp_path):
    """A >5MB file is counted EXACTLY, not sample-extrapolated. The first 1MB is
    newline-free (the old sample window), so the dropped estimator would have
    returned 1; the exact stream count returns the true total. Matches
    utils.content.count_lines so a file's Live count equals its Timeline blob count."""
    from api.utils.content import count_lines

    content = (
        b"x" * (1024 * 1024) + b"y\n" * 2_500_000
    )  # 1MB no-newline head + 5MB of lines
    p = tmp_path / "big.txt"
    p.write_bytes(content)
    assert line_count(p) == 2_500_000
    assert count_lines(content) == 2_500_000


class BinaryAndMediaFlagTests(CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_binary_flag_on_png(self):
        m = _final_manifest(str(FIXTURE))
        for node in walk_files(m.tree):
            if node.name == "logo.png":
                self.assertTrue(node.binary)
                return
        self.fail("logo.png not found in manifest")

    def test_media_kind_on_file_nodes(self):
        # A media file carries its backend-computed classification; a code
        # file carries None. This is the single source the frontend reads.
        m = _final_manifest(str(FIXTURE))
        kinds = {n.name: n.mediaKind for n in walk_files(m.tree)}
        self.assertEqual(kinds.get("logo.png"), "image")
        self.assertIsNone(kinds.get("package.json"))

    def test_binary_type_on_file_nodes(self):
        # A recognized binary file carries its magic-byte type; a code file
        # carries no binaryType at all. End-to-end through the live scan.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "code.py").write_text("print('hi')\n")
            (root / "app.db").write_bytes(
                b"SQLite format 3\x00" + bytes(range(256)) * 20
            )
            commit_all(root)
            m = _final_manifest(str(root))
            types = {n.name: n.binaryType for n in walk_files(m.tree)}
            self.assertEqual(types.get("app.db"), "SQLite database")
            self.assertIsNone(types.get("code.py"))
