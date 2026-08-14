"""Turning a repo on disk into a Manifest.

This file is the package's front door: everything listed below is called by
api/routers/, and everything else in api/scan/ is internal plumbing those
entry points use. If you're looking for where the HTTP layer gets in, it's
here; if a name isn't in __all__, no route depends on it.

The submodules, roughly in the order a scan touches them:

    skiprules   which paths the scanner is allowed to see
    treebuild   the shared DFS builder every build path drives
    filemeta    per-file stat, line counts, binary sniffing
    signatures  the three fingerprints a manifest carries
    stats       the pure per-repo aggregates
    manifest    the envelope wrapped around a built tree
    scanner     the entry points below
    timeline    the per-commit delta bundle
"""

from api.errors import NotAGitRepoError, ScanCancelledError
from .scanner import reconstruct_manifest, scan_tree, signature_tree
from .timeline import ASSEMBLE_STEPS, assemble_tick, build_timeline_bundle

__all__ = [
    "NotAGitRepoError",
    "ScanCancelledError",
    "ASSEMBLE_STEPS",
    "assemble_tick",
    "build_timeline_bundle",
    "reconstruct_manifest",
    "scan_tree",
    "signature_tree",
]
