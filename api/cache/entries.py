"""What a cached per-file or per-blob record looks like.

TypedDicts rather than models: these never reach the wire, they are written and
read as raw JSON, and a cache read is the one place that must tolerate garbage
rather than raise on it.

Both shapes carry the same optional trio — media dims and a binary type — so
the rules for reading and writing those live here once. Media dims are a PAIR:
half of one would size a building against a dimension it doesn't have.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NotRequired, TypedDict, cast

if TYPE_CHECKING:
    # Runtime import would cycle: api.git's __init__ imports git.meta, which
    # imports this package.
    from api.git import BlobStats


class FileEntry(TypedDict):
    """One entry in the per-root file-stat cache. (size, mtime) is the cache
    key; the rest is what a warm scan skips recomputing."""

    size: int
    mtime: float
    lines: int
    binary: bool
    ext: str
    media_width: NotRequired[int]
    media_height: NotRequired[int]
    # Wire/node key (camelCase) reused as the cache key.
    binaryType: NotRequired[str]


class BlobEntry(TypedDict):
    """Content-addressed per-blob stats. Immutable: a git blob's sha fully
    determines its bytes, so an entry is never invalidated."""

    lines: int
    binary: bool
    size: NotRequired[int]  # real byte size (resolved for git-lfs, else blob size)
    media_width: NotRequired[int]
    media_height: NotRequired[int]
    binaryType: NotRequired[str]


def _int_or_none(value: object) -> int | None:
    """bool is an int subclass in Python, and a True that reached a pixel count
    would be a silent 1."""
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def read_media_pair(d: dict[str, object]) -> tuple[int, int] | None:
    """The media dims out of a parsed JSON record, or None unless BOTH are
    present and genuinely ints."""
    width, height = (
        _int_or_none(d.get("media_width")),
        _int_or_none(d.get("media_height")),
    )
    return (width, height) if width is not None and height is not None else None


def apply_optionals(entry: FileEntry | BlobEntry, d: dict[str, object]) -> None:
    """Copy the optional trio from a parsed record onto `entry`, dropping
    anything malformed rather than storing it."""
    pair = read_media_pair(d)
    if pair is not None:
        entry["media_width"], entry["media_height"] = pair
    binary_type = d.get("binaryType")
    if isinstance(binary_type, str):
        entry["binaryType"] = binary_type


def blob_entry(stats: "BlobStats") -> BlobEntry:
    """Freshly-read blob stats → a cache entry, dropping absent fields rather
    than storing them as null."""
    entry: BlobEntry = {
        "lines": stats.lines,
        "binary": stats.binary,
        "size": stats.size,
    }
    if stats.media_width is not None and stats.media_height is not None:
        entry["media_width"] = stats.media_width
        entry["media_height"] = stats.media_height
    if stats.binary_type is not None:
        entry["binaryType"] = stats.binary_type
    return entry


def coerce_file_entry(value: object) -> FileEntry | None:
    """A parsed JSON value as a FileEntry, or None if any required field is
    missing or wrong-typed.

    Drops the entry rather than raising: a partially-corrupt cache file should
    yield its valid entries, not block the whole load."""
    if not isinstance(value, dict):
        return None
    d = cast(dict[str, object], value)
    try:
        size, mtime = d["size"], d["mtime"]
        lines, binary, ext = d["lines"], d["binary"], d["ext"]
    except KeyError:
        return None
    if not isinstance(size, int) or not isinstance(mtime, (int, float)):
        return None
    if not isinstance(lines, int) or not isinstance(binary, bool):
        return None
    if not isinstance(ext, str):
        return None
    entry: FileEntry = {
        "size": size,
        "mtime": float(mtime),
        "lines": lines,
        "binary": binary,
        "ext": ext,
    }
    apply_optionals(entry, d)
    return entry


def coerce_blob_entry(value: object) -> BlobEntry | None:
    """A parsed JSON value as a BlobEntry, or None if it isn't one."""
    if not isinstance(value, dict):
        return None
    d = cast(dict[str, object], value)
    lines, binary = _int_or_none(d.get("lines")), d.get("binary")
    if lines is None or not isinstance(binary, bool):
        return None
    entry: BlobEntry = {"lines": lines, "binary": binary}
    size = _int_or_none(d.get("size"))
    if size is not None:
        entry["size"] = size
    apply_optionals(entry, d)
    return entry
