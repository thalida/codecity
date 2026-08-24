"""What codecity keeps on disk so it doesn't recompute it.

This file is the package's front door: everything listed below is called from
git/, scan/ or routers/, and everything else here is internal. If a name isn't
in __all__, nothing outside this package depends on it.

    storage/   how anything reaches disk and comes back
      paths      where each kind of entry lives, and what it is called
      store      atomic writes, gzip envelopes, the read-returns-None rule

    content/   per-file facts, cached under two different identities
      entries    the record shape both of the below store
      files      keyed by path, staleness checked with (size, mtime)
      blobs      keyed by content sha, and therefore never stale

    results/   whole-repo outputs, replaced wholesale rather than merged
      history    one git-log walk, keyed by the commit it started from
      manifests  built manifests, ref reconstructions, timeline bundles

Every cache here is a pure performance cache: a miss costs time, never
correctness. That is why each read returns empty or None on any problem rather
than raising, and why retention can evict without asking. See README.md for
which key to reach for when adding one.
"""

from api.cache.content.blobs import cache_load_blobs, cache_save_blobs
from api.cache.content.entries import BlobEntry, FileEntry, blob_entry
from api.cache.content.files import cache_load_files, cache_save_files
from api.cache.results.history import cache_load_git_history, cache_save_git_history
from api.cache.results.manifests import (
    cache_clear_timeline,
    cache_load_manifest,
    cache_load_newest_manifest,
    cache_load_ref_manifest,
    cache_load_timeline,
    cache_save_manifest,
    cache_save_ref_manifest,
    cache_save_timeline,
    prune_manifest_cache,
)
from api.cache.storage.paths import repo_key

__all__ = [
    "BlobEntry",
    "FileEntry",
    "blob_entry",
    "cache_clear_timeline",
    "cache_load_blobs",
    "cache_load_files",
    "cache_load_git_history",
    "cache_load_manifest",
    "cache_load_newest_manifest",
    "cache_load_ref_manifest",
    "cache_load_timeline",
    "cache_save_blobs",
    "cache_save_files",
    "cache_save_git_history",
    "cache_save_manifest",
    "cache_save_ref_manifest",
    "cache_save_timeline",
    "prune_manifest_cache",
    "repo_key",
]
