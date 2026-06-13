"""Tests for api/media.py — media dimension probing + MIME classification."""

from __future__ import annotations

import struct
import unittest
import zlib
from pathlib import Path
from tempfile import TemporaryDirectory

from api.services.media import _parse_svg_length, media_kind, probe_media_dims


def _write_minimal_png(path: Path, width: int, height: int) -> None:
    """Write a single-pixel-color PNG of the given dimensions. Smallest
    valid PNG we can build without depending on Pillow inside tests."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    raw = b"\x00" + b"\xff\x00\x00" * width
    raw_rows = raw * height
    idat = chunk(b"IDAT", zlib.compress(raw_rows))
    iend = chunk(b"IEND", b"")
    path.write_bytes(sig + ihdr + idat + iend)


def _write_svg(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


class ImageProbingTests(unittest.TestCase):
    def test_png_dimensions_extracted(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "img.png"
            _write_minimal_png(p, 320, 240)
            w, h = probe_media_dims(p)
            self.assertEqual(w, 320)
            self.assertEqual(h, 240)

    def test_svg_with_explicit_dimensions(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "icon.svg"
            _write_svg(
                p,
                '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>',
            )
            w, h = probe_media_dims(p)
            self.assertEqual(w, 100)
            self.assertEqual(h, 50)

    def test_svg_with_viewbox_only(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "icon.svg"
            _write_svg(
                p, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"></svg>'
            )
            w, h = probe_media_dims(p)
            self.assertEqual(w, 64)
            self.assertEqual(h, 32)

    def test_svg_with_no_dimensions_returns_none(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "icon.svg"
            _write_svg(p, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
            w, h = probe_media_dims(p)
            self.assertIsNone(w)
            self.assertIsNone(h)

    def test_corrupt_image_returns_none(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "broken.png"
            p.write_bytes(b"\x89PNG not really a png")
            w, h = probe_media_dims(p)
            self.assertIsNone(w)
            self.assertIsNone(h)

    def test_non_media_extension_returns_none(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "code.py"
            p.write_text("print('hi')\n")
            w, h = probe_media_dims(p)
            self.assertIsNone(w)
            self.assertIsNone(h)

    def test_svg_with_negative_viewbox_returns_none(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "icon.svg"
            _write_svg(
                p,
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -100 200"></svg>',
            )
            w, h = probe_media_dims(p)
            self.assertIsNone(w)
            self.assertIsNone(h)


class ParseSvgLengthTests(unittest.TestCase):
    """Unit tests for the private _parse_svg_length helper."""

    def test_plain_integer(self):
        self.assertEqual(_parse_svg_length("100"), 100)

    def test_with_px_unit(self):
        self.assertEqual(_parse_svg_length("100px"), 100)

    def test_decimal_rounds(self):
        # 100.5 rounds to 100 (banker's rounding) or 101 — accept either.
        result = _parse_svg_length("100.5")
        self.assertIn(result, (100, 101))

    def test_with_em_unit(self):
        self.assertEqual(_parse_svg_length("100em"), 100)

    def test_percentage_returns_none(self):
        self.assertIsNone(_parse_svg_length("100%"))

    def test_empty_string_returns_none(self):
        self.assertIsNone(_parse_svg_length(""))

    def test_none_returns_none(self):
        self.assertIsNone(_parse_svg_length(None))

    def test_alpha_only_returns_none(self):
        self.assertIsNone(_parse_svg_length("abc"))

    def test_scientific_notation_returns_none(self):
        # "1e2" == 100 in Python float, but SVG lengths don't permit this.
        self.assertIsNone(_parse_svg_length("1e2"))

    def test_negative_value_returns_none(self):
        self.assertIsNone(_parse_svg_length("-1"))

    def test_negative_with_unit_returns_none(self):
        self.assertIsNone(_parse_svg_length("-1px"))


class MediaKindTests(unittest.TestCase):
    """The single-source extension classifier shared with the frontend
    via FileNode.mediaKind."""

    def test_image_extensions(self):
        for ext in (
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
            ".bmp",
            ".ico",
            ".avif",
            ".tiff",
            ".svg",
        ):
            self.assertEqual(media_kind(ext), "image", ext)

    def test_video_extensions(self):
        for ext in (".mp4", ".webm", ".mov", ".ogv", ".m4v", ".mkv"):
            self.assertEqual(media_kind(ext), "video", ext)

    def test_non_media_extensions(self):
        for ext in (".ts", ".md", ".py", ""):
            self.assertIsNone(media_kind(ext), ext)

    def test_case_insensitive(self):
        self.assertEqual(media_kind(".PNG"), "image")
        self.assertEqual(media_kind(".Mp4"), "video")
        self.assertEqual(media_kind(".SVG"), "image")


class VideoProbingTests(unittest.TestCase):
    def test_corrupt_video_returns_none(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "broken.mp4"
            p.write_bytes(b"not really an mp4")
            w, h = probe_media_dims(p)
            self.assertIsNone(w)
            self.assertIsNone(h)

    def test_empty_video_returns_none(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "empty.webm"
            p.write_bytes(b"")
            w, h = probe_media_dims(p)
            self.assertIsNone(w)
            self.assertIsNone(h)


if __name__ == "__main__":
    unittest.main()
