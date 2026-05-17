"""Probe natural pixel dimensions of media files.

probe_media_dims(path) returns (width, height) — both None when the
file can't be probed (unsupported extension, missing metadata, corrupt
container, etc.). Layout uses these to size the building's silhouette;
None pairs trigger the square-fallback aspect of 1.0.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

_PIL_IMAGE_EXTS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".bmp", ".ico", ".avif", ".tiff",
})
_SVG_EXTS = frozenset({".svg"})


def probe_media_dims(path: Path) -> tuple[int | None, int | None]:
    """Return (width, height) in pixels, or (None, None) when not probeable.

    Failures are silent: any exception (corrupt file, missing codec,
    unparseable XML, missing metadata) returns (None, None). Callers
    treat None as "no signal" and fall back to a default aspect ratio.
    """
    ext = path.suffix.lower()
    if ext in _SVG_EXTS:
        return _probe_svg(path)
    if ext in _PIL_IMAGE_EXTS:
        return _probe_image(path)
    return None, None


def _probe_image(path: Path) -> tuple[int | None, int | None]:
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        return None, None
    try:
        with Image.open(path) as img:
            w, h = img.size
        return int(w), int(h)
    except Exception:
        return None, None


def _probe_svg(path: Path) -> tuple[int | None, int | None]:
    """Parse <svg width=… height=…> or viewBox to recover intrinsic size.

    Pillow can't read most SVGs (it's a vector format, not raster), so we
    parse the container ourselves. Width/height attributes win over
    viewBox when both are present — viewBox is a fallback per the SVG
    spec when the element has no explicit pixel dimensions.
    """
    try:
        tree = ET.parse(path)
        root = tree.getroot()
    except (ET.ParseError, OSError):
        return None, None

    w = _parse_svg_length(root.get("width"))
    h = _parse_svg_length(root.get("height"))
    if w is not None and h is not None:
        return w, h

    viewbox = root.get("viewBox")
    if viewbox:
        parts = viewbox.replace(",", " ").split()
        if len(parts) == 4:
            try:
                vb_w = int(round(float(parts[2])))
                vb_h = int(round(float(parts[3])))
                return vb_w, vb_h
            except ValueError:
                pass

    return None, None


def _parse_svg_length(value: str | None) -> int | None:
    """SVG width/height may carry units (px, pt, em). Strip a trailing
    non-numeric suffix and parse the leading number; reject percentages
    (no intrinsic pixel value)."""
    if value is None:
        return None
    v = value.strip()
    if not v or v.endswith("%"):
        return None
    # Walk back from the end to find where the numeric prefix ends.
    i = len(v)
    while i > 0 and not (v[i - 1].isdigit() or v[i - 1] == "."):
        i -= 1
    try:
        return int(round(float(v[:i])))
    except ValueError:
        return None
