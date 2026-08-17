"""Everything that shells out to git.

This file is the package's front door. Everything the rest of the api uses is
listed below; everything else in api/git/ is internal. If a name isn't in
__all__, nothing outside this package depends on it — which means a submodule
can be reorganised without touching a caller.

    cmd       how a git command against a local repo is invoked
    source    what a `src` string is, and where it resolves on disk
    clone     fetching and updating a remote into the local cache
    objects   the object database (ls-tree, cat-file, blob stats)
    meta      history walks, working-tree state, the repo footer

The package's operational notes — why safe.directory is not optional, what
blobless clones force on the timeline, how large clones fail — are in README.md.
"""

from .clone import (
    CloneProgress,
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    clone_dir_for,
    ensure_clone,
    fetch_lfs_history,
    hydrate_blobs,
    list_remote_branches,
)
from .cmd import git_argv, run_git
from .meta import (
    GitHistory,
    GitState,
    build_authors_list,
    collect_git_history,
    collect_git_state,
    empty_repo_info,
    is_git_repo,
    reconstructed_repo_info,
)
from .objects import (
    BlobStats,
    TreeBlob,
    blob_sizes_batch,
    blob_stats_batch,
    ls_tree_files,
    read_blob,
    resolve_ref,
)
from .source import (
    ResolveError,
    SourceKind,
    classify,
    resolve_local,
    resolve_source,
)

__all__ = [
    "BlobStats",
    "BranchNotFoundError",
    "CloneError",
    "CloneProgress",
    "GitHistory",
    "GitState",
    "HostUnreachableError",
    "RepoNotFoundError",
    "ResolveError",
    "SourceKind",
    "TreeBlob",
    "blob_sizes_batch",
    "blob_stats_batch",
    "build_authors_list",
    "classify",
    "clone_dir_for",
    "collect_git_history",
    "collect_git_state",
    "empty_repo_info",
    "ensure_clone",
    "fetch_lfs_history",
    "git_argv",
    "hydrate_blobs",
    "is_git_repo",
    "list_remote_branches",
    "ls_tree_files",
    "read_blob",
    "reconstructed_repo_info",
    "resolve_local",
    "resolve_ref",
    "resolve_source",
    "run_git",
]
