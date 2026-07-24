"""Binary-file format detection + byte-pattern fingerprinting.

Two concerns for the "data building" treatment of binary files (issue #116):

  - detect_binary_type(head) — a friendly type name from magic bytes
    ("SQLite database", "WebAssembly module", "ELF shared object"), or None
    when the signature isn't recognized. Covers non-media binary formats only:
    images/video are classified as media by extension (media.py) and never
    reach this path.
  - fingerprint_png(data) — a small fixed-size grayscale PNG "digram" of the
    file's byte pattern. Distinct file *types* land visually distinct textures.
    Computed server-side so raw binaries never ship to the client (a 5 MB .wasm
    fingerprints from its first 64 KiB, not its full bytes).

Both are pure functions of the input bytes, so their results are safe to cache
content-addressed (per blob sha) alongside lines/binary.
"""

from __future__ import annotations

import io
import math

from PIL import Image

# ── Magic-byte type detection ───────────────────────────────────────────

# Longest-prefix-wins isn't needed: every signature below is unambiguous at its
# offset, so a simple first-match walk suffices. Ordered roughly by how specific
# / common the format is. Image and video magics are intentionally absent —
# those files are media (classified by extension in media.py) and render as
# billboards, not data buildings.


def detect_binary_type(head: bytes) -> str | None:
    """Friendly type name for a binary file from its leading bytes, or None
    when unrecognized. `head` need only be the first ~64 bytes."""
    if head.startswith(b"SQLite format 3\x00"):
        return "SQLite database"
    if head.startswith(b"\x00asm"):
        return "WebAssembly module"
    if head.startswith(b"\x7fELF"):
        # e_type is a little-endian half at offset 16: 2 = executable,
        # 3 = shared object (also PIE executables). Low byte is enough.
        etype = head[16] if len(head) > 16 else 0
        if etype == 3:
            return "ELF shared object"
        if etype == 2:
            return "ELF executable"
        return "ELF binary"
    if head[:4] in (
        b"\xfe\xed\xfa\xce",
        b"\xfe\xed\xfa\xcf",
        b"\xce\xfa\xed\xfe",
        b"\xcf\xfa\xed\xfe",
    ):
        return "Mach-O binary"
    if head.startswith(b"\xca\xfe\xba\xbe"):
        return "Java class file"
    if head.startswith(b"MZ"):
        return "Windows executable"
    if head.startswith(b"wOF2"):
        return "WOFF2 font"
    if head.startswith(b"wOFF"):
        return "WOFF font"
    if head.startswith(b"OTTO"):
        return "OpenType font"
    if head.startswith(b"\x00\x01\x00\x00"):
        return "TrueType font"
    if head.startswith(b"%PDF-"):
        return "PDF document"
    if head[:4] in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"):
        return "ZIP archive"
    if head.startswith(b"\x1f\x8b"):
        return "gzip archive"
    if head.startswith(b"BZh"):
        return "bzip2 archive"
    if head.startswith(b"\xfd7zXZ\x00"):
        return "XZ archive"
    if head.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7-Zip archive"
    if head.startswith(b"Rar!\x1a\x07"):
        return "RAR archive"
    return None


# ── Byte-pattern fingerprint ────────────────────────────────────────────

# Read at most this many bytes to fingerprint — a representative digram, never
# the whole file. A big .wasm/.so reads its head, not its megabytes.
FINGERPRINT_SAMPLE_BYTES = 1 << 16  # 64 KiB
# Digram grid is intrinsically 256x256 (one cell per byte-value pair); we emit
# it at that resolution and let the facade texture pipeline downscale.
_DIGRAM_EDGE = 256


def fingerprint_png(data: bytes) -> bytes:
    """Render a byte-pair 'digram' fingerprint of `data` as a 256x256 grayscale
    PNG. Each consecutive pair (b[i], b[i+1]) is a coordinate in the grid; cell
    intensity is the log-scaled hit frequency. Text clusters along the ASCII
    diagonal, compressed data fills uniformly, executables show grid structure,
    so distinct file types read as distinct textures. Neutral grayscale — the
    shader and preview card tint it to theme."""
    sample = data[:FINGERPRINT_SAMPLE_BYTES]
    counts = [0] * (_DIGRAM_EDGE * _DIGRAM_EDGE)
    prev = -1
    for b in sample:
        if prev >= 0:
            counts[prev * _DIGRAM_EDGE + b] += 1
        prev = b

    peak = max(counts) if counts else 0
    if peak == 0:
        # 0 or 1 byte: no digrams. A flat black tile is an honest "no pattern".
        img = Image.new("L", (_DIGRAM_EDGE, _DIGRAM_EDGE), 0)
    else:
        log_peak = math.log1p(peak)
        pixels = bytes(
            0 if c == 0 else int(255 * math.log1p(c) / log_peak) for c in counts
        )
        img = Image.frombytes("L", (_DIGRAM_EDGE, _DIGRAM_EDGE), pixels)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
