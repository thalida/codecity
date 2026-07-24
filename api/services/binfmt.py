"""Binary-file format detection + byte-pattern fingerprinting (issue #116).

Both are pure functions of the input bytes (safe to cache content-addressed per
blob sha). Fingerprints are computed server-side so raw binaries never ship — a
5 MB .wasm fingerprints from its first 64 KiB.
"""

from __future__ import annotations

import io
import math

from PIL import Image

# ── Magic-byte type detection ───────────────────────────────────────────

# Image/video magics are absent on purpose: those are media (classified by
# extension in media.py), not data buildings, so they never reach this path.


def detect_binary_type(head: bytes) -> str | None:
    """Friendly type name for a binary file from its leading bytes, or None
    when unrecognized. `head` need only be the first ~64 bytes."""
    if head.startswith(b"SQLite format 3\x00"):
        return "SQLite database"
    if head.startswith(b"\x00asm"):
        return "WebAssembly module"
    if head.startswith(b"\x7fELF"):
        # e_type (LE half at offset 16): 2 = executable, 3 = shared object / PIE.
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

# Head bytes sampled — never the whole file (a big .wasm/.so reads its head).
FINGERPRINT_SAMPLE_BYTES = 1 << 16  # 64 KiB
# Emitted at the frontend PANEL_TEX_SIZE so the texture pipeline never downscales
# it (which averages the sparse marks into near-invisibility). Byte pairs bin to
# EDGE cells per axis (value >> 1), which also makes each cell denser.
_DIGRAM_EDGE = 128
# Any byte-pair that occurs at all is at least this opaque, so a sparse pattern
# still reads clearly over the wall rather than fading to nothing.
_ALPHA_FLOOR = 160


def fingerprint_png(data: bytes) -> bytes:
    """Byte-pair 'digram' fingerprint of `data` as a white-on-transparent PNG
    (mode LA): each consecutive pair (b[i], b[i+1]) is a grid cell whose ALPHA is
    its log-scaled frequency (floored so present pairs read), transparent where a
    pair never occurs. Distinct file types land distinct patterns (text on the
    ASCII diagonal, compressed uniform, executables gridded)."""
    sample = data[:FINGERPRINT_SAMPLE_BYTES]
    counts = [0] * (_DIGRAM_EDGE * _DIGRAM_EDGE)
    prev = -1
    for b in sample:
        if prev >= 0:
            counts[(prev >> 1) * _DIGRAM_EDGE + (b >> 1)] += 1
        prev = b

    peak = max(counts) if counts else 0
    pixels = bytearray(len(counts) * 2)
    if peak > 0:
        log_peak = math.log1p(peak)
        span = 255 - _ALPHA_FLOOR
        for i, c in enumerate(counts):
            if c:
                pixels[2 * i] = 255  # white mark
                pixels[2 * i + 1] = _ALPHA_FLOOR + int(span * math.log1p(c) / log_peak)
    img = Image.frombytes("LA", (_DIGRAM_EDGE, _DIGRAM_EDGE), bytes(pixels))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
