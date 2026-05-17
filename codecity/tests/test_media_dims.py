"""Tests for codecity/media_dims.py — media dimension probing."""

from __future__ import annotations

import struct
import unittest
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path
from tempfile import TemporaryDirectory

from codecity.media_dims import probe_media_dims


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
            _write_svg(p, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>')
            w, h = probe_media_dims(p)
            self.assertEqual(w, 100)
            self.assertEqual(h, 50)

    def test_svg_with_viewbox_only(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "icon.svg"
            _write_svg(p, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"></svg>')
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


if __name__ == "__main__":
    unittest.main()
