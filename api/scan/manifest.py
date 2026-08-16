"""The Manifest envelope around an already-built tree.

Every emit — skeleton, metadata, final, and both time-travel manifests — goes
through wrap_manifest, so they differ only in the tree they pass and what
`pending` still declares provisional."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from api.core.config import MAX_WIRE_COMMITS
from api.git.source import label_from_source
from api.models.manifest import (
    CommitEntry,
    DirNode,
    FileNode,
    Manifest,
    RepoInfo,
    ScanStage,
)
from api.scan.signatures import TreeSignals
from api.scan.stats import (
    annotate_same_day_totals,
    busyness_thresholds,
    commit_day_counts,
    compute_repo_stats,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sample_commits(commits: list[CommitEntry]) -> list[CommitEntry]:
    """At most MAX_WIRE_COMMITS, evenly strided with both ends kept. The
    renderer strides deep histories down to its placement grid anyway; this
    moves that upstream of the wire."""
    total = len(commits)
    if total <= MAX_WIRE_COMMITS:
        return commits
    stride = (total - 1) / max(1, MAX_WIRE_COMMITS - 1)
    return [commits[round(i * stride)] for i in range(MAX_WIRE_COMMITS)]


def _find_root_readme(tree: DirNode) -> tuple[str | None, str | None]:
    """(fullPath, modified) of the root README, matching any direct child
    whose stem is "readme" — the rule GitHub and VSCode use."""
    for child in tree.children:
        if not isinstance(child, FileNode):
            continue
        name = child.name.lower()
        if name == "readme" or name.startswith("readme."):
            return child.fullPath, child.modified
    return None, None


def wrap_manifest(
    root_abs: str,
    tree: DirNode,
    sig: Any,
    signals: TreeSignals,
    repo_info: RepoInfo,
    commits: list[CommitEntry],
    pending: list[ScanStage],
    *,
    sample: bool = True,
) -> Manifest:
    """`commits` is the full history: aggregates read it whole, only the wire
    array is sampled."""
    day_counts = commit_day_counts(commits)
    annotate_same_day_totals(commits, day_counts)
    # THE canonical display name, baked once and cached with the manifest: the
    # remote's owner/repo beats the on-disk basename, which is a clone's cache
    # hash or a worktree's folder name. Consumers read tree.name, never redo this.
    tree.name = label_from_source(repo_info.remote_url) or tree.name
    readme_path, readme_modified = _find_root_readme(tree)
    return Manifest(
        root=root_abs,
        scanned_at=utc_now_iso(),
        content_signature=sig.hexdigest(),
        structure_signature=signals.structure_signature,
        layout_signature=signals.layout_signature,
        tree=tree,
        repo=repo_info,
        commits=sample_commits(commits) if sample else commits,
        pending=pending,
        busyness=busyness_thresholds(day_counts),
        dateRanges=signals.date_ranges,
        stats=compute_repo_stats(tree, commits),
        readmePath=readme_path,
        readmeModified=readme_modified,
    )
