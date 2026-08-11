"""Binary format detection + byte-pattern fingerprint (issue #116)."""

from __future__ import annotations

import io

from PIL import Image

from api.binfmt import detect_binary_type, fingerprint_png


class TestDetectBinaryType:
    def test_named_signatures(self):
        # The three the issue calls out by name, plus common companions.
        assert detect_binary_type(b"SQLite format 3\x00\x00\x10") == "SQLite database"
        assert detect_binary_type(b"\x00asm\x01\x00\x00\x00") == "WebAssembly module"
        assert detect_binary_type(b"PK\x03\x04rest") == "ZIP archive"
        assert detect_binary_type(b"\x1f\x8b\x08rest") == "gzip archive"
        assert detect_binary_type(b"MZ\x90\x00") == "Windows executable"

    def test_elf_variants_read_e_type(self):
        # e_type (offset 16) distinguishes executable (2) from shared object (3).
        base = b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 8
        assert detect_binary_type(base + b"\x02\x00") == "ELF executable"
        assert detect_binary_type(base + b"\x03\x00") == "ELF shared object"
        # Header too short to read e_type still classifies as generic ELF.
        assert detect_binary_type(b"\x7fELF") == "ELF binary"

    def test_unrecognized_returns_none(self):
        assert detect_binary_type(b"just some plain text\n") is None
        assert detect_binary_type(b"") is None


class TestFingerprintPng:
    def _decode(self, data: bytes) -> Image.Image:
        return Image.open(io.BytesIO(data))

    def test_white_on_transparent_png_with_alpha_floor(self):
        from api.binfmt import _ALPHA_FLOOR

        img = self._decode(fingerprint_png(b"the quick brown fox " * 200))
        assert img.format == "PNG"
        assert img.size == (128, 128)
        # LA: white luminance, alpha = byte-pair density (transparent background).
        assert img.mode == "LA"
        lo, hi = img.getchannel("A").getextrema()
        assert lo == 0  # empty cells fully transparent
        assert hi >= _ALPHA_FLOOR  # present pairs read at the floor or above

    def test_deterministic_and_type_distinct(self):
        # Same bytes → identical fingerprint; different byte patterns → different
        # texture (that's the whole point — a .db and a .wasm must look unlike).
        a1 = fingerprint_png(b"aaaa" * 500)
        a2 = fingerprint_png(b"aaaa" * 500)
        b = fingerprint_png(bytes(range(256)) * 100)
        assert a1 == a2
        assert a1 != b

    def test_degenerate_inputs_still_valid_png(self):
        # 0 and 1 byte have no digrams; must not crash and stay a valid PNG.
        for data in (b"", b"\x00"):
            img = self._decode(fingerprint_png(data))
            assert img.size == (128, 128)
