"""ISO-8601 date strings, the one form dates take through the manifest.

Everything is the Z-suffixed UTC form, which makes a string compare a
chronological compare — that is why the tree rollups can fold dates with
min/max instead of parsing them, and why the whole manifest can carry dates
as strings at all.
"""

from __future__ import annotations

from datetime import datetime, timezone

_ISO_Z = "%Y-%m-%dT%H:%M:%SZ"


def min_iso(a: str | None, b: str | None) -> str | None:
    """Lexically-smaller (earliest) of two ISO date strings, ignoring None."""
    if a is None:
        return b
    if b is None:
        return a
    return a if a < b else b


def max_iso(a: str | None, b: str | None) -> str | None:
    """Lexically-larger (latest) of two ISO date strings, ignoring None."""
    if a is None:
        return b
    if b is None:
        return a
    return a if a > b else b


def day_of(iso: str) -> str:
    """The calendar day (YYYY-MM-DD) of a full timestamp."""
    return iso[:10]


def epoch_to_iso(epoch: float) -> str:
    """A filesystem mtime/birthtime as a UTC ISO string."""
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime(_ISO_Z)


def utc_now_iso() -> str:
    """Now, in the same form every other date in the manifest takes."""
    return datetime.now(timezone.utc).strftime(_ISO_Z)


def to_utc_iso(iso: str) -> str:
    """Normalise an offset-carrying stamp (git's %aI) to the Z-suffixed form, so
    it sorts against the filesystem dates. Unparseable input passes through."""
    try:
        return datetime.fromisoformat(iso).astimezone(timezone.utc).strftime(_ISO_Z)
    except ValueError:
        return iso


def iso_to_ms(value: str | None) -> int | None:
    """Epoch milliseconds for a Z-suffixed stamp, or None.

    Matches JS Date.parse, since these values are compared against client-side
    dates."""
    if not value:
        return None
    try:
        parsed = datetime.strptime(value, _ISO_Z)
    except ValueError:
        return None
    return int(parsed.replace(tzinfo=timezone.utc).timestamp() * 1000)
