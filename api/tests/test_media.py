"""Tests for api/utils/media.py — media dimension probing + MIME classification."""

from __future__ import annotations

import struct
import zlib

import pytest
from pathlib import Path
from tempfile import TemporaryDirectory

from api.utils.media import _parse_svg_length, media_kind, probe_media_dims


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


def test_png_dimensions_come_from_the_ihdr_chunk():
    with TemporaryDirectory() as tmp:
        p = Path(tmp) / "img.png"
        _write_minimal_png(p, 320, 240)
        assert probe_media_dims(p) == (320, 240)


_SVG = '<svg xmlns="http://www.w3.org/2000/svg" %s></svg>'


@pytest.mark.parametrize(
    ("attrs", "expected"),
    [
        ('width="100" height="50"', (100, 50)),
        ('viewBox="0 0 64 32"', (64, 32)),
        # Explicit dimensions win over a viewBox that disagrees.
        ('width="100" height="50" viewBox="0 0 64 32"', (100, 50)),
        ("", (None, None)),
        ('viewBox="0 0 -100 200"', (None, None)),
    ],
)
def test_svg_dimensions(attrs, expected):
    with TemporaryDirectory() as tmp:
        p = Path(tmp) / "icon.svg"
        _write_svg(p, _SVG % attrs)
        assert probe_media_dims(p) == expected


@pytest.mark.parametrize(
    ("name", "content"),
    [("broken.png", b"\x89PNG not really a png"), ("code.py", b"print('hi')\n")],
)
def test_unreadable_or_non_media_returns_no_dims(name, content):
    with TemporaryDirectory() as tmp:
        p = Path(tmp) / name
        p.write_bytes(content)
        assert probe_media_dims(p) == (None, None)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("100", 100),
        ("100px", 100),
        ("100em", 100),
        # A unit SVG does not define still parses: the number is what matters.
        ("100pt", 100),
        ("100%", None),
        ("", None),
        (None, None),
        ("abc", None),
        # "1e2" is 100.0 to float(), but SVG lengths do not permit exponents.
        ("1e2", None),
        ("-1", None),
        ("-1px", None),
    ],
)
def test_parse_svg_length(raw, expected):
    assert _parse_svg_length(raw) == expected


def test_parse_svg_length_rounds_a_decimal():
    # Banker's rounding puts 100.5 either side; both are acceptable.
    assert _parse_svg_length("100.5") in (100, 101)


# media_kind is the single-source extension classifier the frontend reads back
# off FileNode.mediaKind, so the whole supported set is worth naming.
@pytest.mark.parametrize(
    "ext",
    [
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
    ],
)
def test_media_kind_images(ext):
    assert media_kind(ext) == "image"


@pytest.mark.parametrize("ext", [".mp4", ".webm", ".mov", ".ogv", ".m4v", ".mkv"])
def test_media_kind_videos(ext):
    assert media_kind(ext) == "video"


@pytest.mark.parametrize("ext", [".ts", ".md", ".py", ""])
def test_media_kind_non_media(ext):
    assert media_kind(ext) is None


@pytest.mark.parametrize(
    ("ext", "expected"), [(".PNG", "image"), (".Mp4", "video"), (".SVG", "image")]
)
def test_media_kind_is_case_insensitive(ext, expected):
    assert media_kind(ext) == expected


@pytest.mark.parametrize(
    ("name", "content"), [("broken.mp4", b"not really an mp4"), ("empty.webm", b"")]
)
def test_unreadable_video_returns_no_dims(name, content):
    with TemporaryDirectory() as tmp:
        p = Path(tmp) / name
        p.write_bytes(content)
        assert probe_media_dims(p) == (None, None)
