"""Facts read straight out of a file's bytes: is it binary, how many lines.

Pure functions of the input, with no notion of where the bytes came from — the
live scan reads them off disk and the timeline reads them out of a git blob,
and both must classify identically or a file changes character when you scrub.
That shared rule is why these live here rather than in either caller.
"""

from __future__ import annotations

from pathlib import Path

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


def _line_total(newlines: int, last_byte: bytes) -> int:
    """The counting rule itself: newlines, plus one for a final line that was
    never terminated. Empty input is zero lines, not one.

    Stated once because a file read off disk and the same file read out of a
    git blob take different paths to get here, and a building would change
    height between Live and Timeline if the two ever disagreed."""
    if not last_byte:
        return 0
    return newlines + (0 if last_byte == b"\n" else 1)


def count_lines(data: bytes) -> int:
    """Lines in a buffer already in memory — a git blob."""
    return _line_total(data.count(b"\n"), data[-1:])


def count_lines_at(path: Path) -> int:
    """Lines in a file on disk, read in chunks so a multi-GB file costs no more
    memory than a small one. 0 if it can't be read."""
    try:
        newlines = 0
        last_byte = b""
        with path.open("rb") as fh:
            while chunk := fh.read(1 << 20):
                newlines += chunk.count(b"\n")
                last_byte = chunk[-1:]
        return _line_total(newlines, last_byte)
    except OSError:
        return 0
