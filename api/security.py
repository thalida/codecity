"""The session trust model.

SINGLE-PROCESS INVARIANT: `allowed_roots` is in-memory module state.
The app MUST run as one process — multi-worker (gunicorn) would split
the trust set across workers and break /api/file and /api/commit. The
Dockerfile and __main__ run a single uvicorn process for this reason.

Trust rule: every successful manifest scan registers its absolute root.
/api/file and /api/commit then validate that the requested path resolves
under at least one registered root — there is no global filesystem read.
"""
from __future__ import annotations

import threading
from pathlib import Path


class OutsideRootError(Exception):
    """Requested path resolves outside every registered scan root."""


class NoRootsRegisteredError(Exception):
    """No scan root registered yet — caller must fetch /api/manifest first."""


class TrustStore:
    """Thread-safe set of absolute roots that have been scanned this session."""

    def __init__(self) -> None:
        self._roots: set[Path] = set()
        self._lock = threading.Lock()
        # Serializes clone-or-update so two concurrent manifest requests for
        # the same URL don't race the working tree.
        self.clone_lock = threading.Lock()

    def reset(self) -> None:
        """Fresh trust set (per-process start; tests call between cases)."""
        with self._lock:
            self._roots = set()

    def register(self, root: Path) -> None:
        with self._lock:
            self._roots.add(root.resolve())

    def snapshot(self) -> set[Path]:
        with self._lock:
            return set(self._roots)

    def assert_inside(self, raw: Path) -> Path:
        """Resolve `raw` (strict) and confirm it sits under a registered root.

        Raises NoRootsRegisteredError if none registered, OutsideRootError
        if the resolved path escapes every root. Returns the resolved path.
        """
        roots = self.snapshot()
        if not roots:
            raise NoRootsRegisteredError
        target = raw.resolve(strict=True)
        for root in roots:
            try:
                target.relative_to(root)
            except ValueError:
                continue
            return target
        raise OutsideRootError


# Module-level singleton — the one trust set for the process.
TRUST = TrustStore()
