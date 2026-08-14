"""Everything that shells out to git.

This file is the package's front door: everything listed below is called by
api/routers/, and everything else in api/git/ is internal. If a name isn't in
__all__, no route depends on it.

    source    what a `src` string is, and where it resolves on disk
    clone     fetching and updating a remote into the local cache
    objects   the object database (ls-tree, cat-file, blob stats)
    meta      history walks, working-tree state, the repo footer
"""

from .clone import (
    CloneProgress,
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    ensure_clone,
    fetch_lfs_history,
    hydrate_blobs,
    list_remote_branches,
)
from .meta import build_authors_list
from .objects import read_blob, resolve_ref
from .source import (
    ResolveError,
    SourceKind,
    classify,
    label_from_source,
    resolve_local,
    resolve_source,
)

__all__ = [
    "CloneProgress",
    "BranchNotFoundError",
    "CloneError",
    "HostUnreachableError",
    "RepoNotFoundError",
    "ResolveError",
    "SourceKind",
    "build_authors_list",
    "classify",
    "ensure_clone",
    "fetch_lfs_history",
    "hydrate_blobs",
    "label_from_source",
    "list_remote_branches",
    "read_blob",
    "resolve_local",
    "resolve_ref",
    "resolve_source",
]
