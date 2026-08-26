"""What a git object sha looks like.

Three call sites validate one — a rev-parse result, a `?sha=` query param, and
a sha read back out of a cache file — and they have to agree, or a value one
accepts is rejected by the next.
"""

from __future__ import annotations

import re

# Full 40-char lowercase hex, which is what git emits and what every stored or
# transmitted sha in codecity is. Abbreviated and uppercase forms are rejected.
_OBJECT_SHA = re.compile(r"[0-9a-f]{40}")


def is_object_sha(value: str) -> bool:
    """True for a full 40-char lowercase hex sha, and nothing else."""
    return _OBJECT_SHA.fullmatch(value) is not None
