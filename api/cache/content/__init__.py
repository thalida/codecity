"""Per-file content facts: lines, binary, media dims, binary type.

The same facts, cached under two different identities, because the two build
paths have two different ways of naming a file:

    files   keyed by path, staleness checked with (size, mtime)
    blobs   keyed by content sha, and therefore never stale

`entries` holds the record shape both store, which is why it lives with them
rather than beside the caches as if it were a third one.
"""
