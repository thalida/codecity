"""Facts read straight out of a file's bytes: is it binary, how many lines.

Pure functions of the input, with no notion of where the bytes came from — the
live scan reads them off disk and the timeline reads them out of a git blob,
and both must classify identically or a file changes character when you scrub.
That shared rule is why these live here rather than in either caller.
"""

from __future__ import annotations

# Bytes sampled when deciding binary-ness. Enough to catch a NUL or a dense run
# of control bytes; small enough that a multi-GB file costs one short read.
BINARY_CHUNK = 8192

_TEXT_CHARACTERS = bytes({7, 8, 9, 10, 11, 12, 13, 27}) + bytes(range(0x20, 0x100))


def is_binary_bytes(chunk: bytes) -> bool:
    """True when `chunk` looks like binary content. A NUL byte is decisive; past
    that, more than 30% non-text bytes in the sample."""
    head = chunk[:BINARY_CHUNK]
    if not head:
        return False
    if b"\x00" in head:
        return True
    non_text = sum(1 for b in head if b not in _TEXT_CHARACTERS)
    return non_text / len(head) > 0.30


def count_lines(data: bytes) -> int:
    """Line count: newlines + 1 for an unterminated final line (empty → 0).

    filemeta.line_count streams the identical rule over a file handle, so a
    file reports the same height Live and in Timeline."""
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)
