"""Getting bytes onto disk, and back, without ever breaking a scan.

Two invariants the whole package rests on:

  - Writes are atomic (tempfile + rename), so an interrupted scan cannot leave
    a half-written file that the next run reads as real.
  - Reads return None on ANY problem — missing, truncated, wrong version,
    unparseable. Every cache here is rebuildable, so a miss costs time while a
    bad hit costs correctness.
"""

from __future__ import annotations

import gzip
import json
import os
import tempfile
from pathlib import Path
from typing import cast


def atomic_write(path: Path, data: str) -> None:
    """Write `data` to `path` via tempfile + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_json(path: Path, *, version: object) -> dict[str, object] | None:
    """A plain-JSON cache file, or None if it is absent, corrupt, or stale."""
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    raw = cast(dict[str, object], parsed)
    return None if raw.get("version") != version else raw


def load_gz_envelope(
    path: Path, *, envelope_key: str, version: object
) -> dict[str, object] | None:
    """A ``{"version", envelope_key: <dict>}`` gzip cache; None on any error."""
    try:
        with gzip.open(path, "rb") as fh:
            raw = json.loads(fh.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    envelope = cast(dict[str, object], raw)
    if envelope.get("version") != version:
        return None
    payload = envelope.get(envelope_key)
    if not isinstance(payload, dict):
        return None
    return cast(dict[str, object], payload)


def save_gz_envelope(
    path: Path, *, envelope_key: str, version: object, payload: dict[str, object]
) -> None:
    """Atomically write a ``{"version", envelope_key: <dict>}`` gzip cache.

    Swallows OSError: a cache write that fails must not fail the response it
    was a side effect of."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps({"version": version, envelope_key: payload}).encode("utf-8")
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as fh:
            with gzip.GzipFile(fileobj=fh, mode="wb") as gz:
                gz.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except OSError:
        Path(tmp).unlink(missing_ok=True)
