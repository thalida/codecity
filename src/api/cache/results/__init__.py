"""Whole-repo outputs, cached so a repeat request doesn't rebuild them.

Where content/ caches a fact per file and merges, these cache one large derived
object per repo state and replace it wholesale:

    history     one git-log walk, keyed by the commit it started from
    manifests   built manifests, ref reconstructions and timeline bundles

They are also the expensive ones. A content miss costs a file read; a miss here
costs a walk or a full scan.
"""
