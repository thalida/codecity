"""Timeline bundle: one git-history walk → per-commit blob deltas, replayed
client-side for smooth scrubbing. Read-only; reuses git/objects' plumbing."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Callable, NamedTuple

from api.cache import BlobEntry
from api.git import (
    SourceRef,
    blob_sizes_batch,
    collect_git_history,
    empty_repo_info,
    git_argv,
    is_git_repo,
    reconstructed_repo_info,
)
from api.core.constants import TimelineStage
from api.models.manifest import (
    CommitEntry,
    DateRangeMs,
    FileNode,
    Manifest,
    RangeStat,
    TimelineBundle,
    TimelineChange,
    TimelineDelta,
)
from api.scan.blobmeta import MISSING_BLOB, blob_file_node, resolve_blob_stats
from api.scan.manifest import wrap_manifest
from api.core.progress import Throttle, log
from api.utils.dates import iso_to_ms
from api.core.exceptions import NotAGitRepoError
from api.scan.signatures import derive_tree_signals, new_signature
from api.scan.skiprules import SkipRules
from api.scan.treebuild import build_tree, dir_children_from_paths

_UNION_FILE_CAP = 50000  # union files above this window to the most recent commits

# Progress payload: a TimelineStage plus that stage's counters (commits, or
# done/total). The router translates it into the wire TimelineProgressEvent.
OnTimelineProgress = Callable[[dict[str, object]], None]

_HISTORY_HEARTBEAT_EVERY = 2000  # commits between progress ticks

# Four steps, a quarter of the percent each. The last is the router's:
# serialising the bundle is the step nothing else can report.
ASSEMBLE_STEPS = 4
# Commits between ticks inside a step that reports its own progress.
_ASSEMBLE_HEARTBEAT_EVERY = 200


def assemble_tick(
    on_progress: OnTimelineProgress | None, step: int, within: float = 0.0
) -> None:
    """Report assembly at `step` of ASSEMBLE_STEPS, `within` 0..1 through it."""
    if on_progress is None:
        return
    percent = int(((step - 1 + min(max(within, 0.0), 1.0)) / ASSEMBLE_STEPS) * 100)
    on_progress({"stage": TimelineStage.ASSEMBLE, "percent": percent})


class CommitDelta(NamedTuple):
    sha: str
    changes: list[tuple[str, str | None]]  # (path, new_blob_sha | None=delete)


def walk_deltas(
    root: Path,
    ref: str | None = None,
    *,
    on_progress: OnTimelineProgress | None = None,
) -> list[CommitDelta]:
    """Per-commit (path -> new blob sha, or None on delete), oldest-first.
    --no-abbrev keeps full 40-hex shas so blob lookups resolve; --no-renames
    records a rename as delete+add (matches the reconstruction semantics).
    ``on_progress`` gets a heartbeat every ``_HISTORY_HEARTBEAT_EVERY``
    commits (also time-throttled, for repos where git log outpaces that
    count), plus a final tick with the true total."""
    log("walking commit history for timeline deltas…")
    argv = git_argv(
        root,
        "log",
        "--format=COMMIT:%H",
        "--raw",
        "--no-abbrev",
        "--no-renames",
        # Merges undiffed (matches the scan walk): a subtree merge must not
        # re-add its files on the merge date.
    )
    if ref is not None:
        argv.append(ref)
    proc = subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    newest_first: list[CommitDelta] = []
    cur: CommitDelta | None = None
    commits = 0
    ticks: Throttle[dict[str, object]] = Throttle(on_progress)
    assert proc.stdout is not None
    try:
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            if not line:
                continue
            if line.startswith("COMMIT:"):
                cur = CommitDelta(sha=line[len("COMMIT:") :], changes=[])
                newest_first.append(cur)
                commits += 1
                if commits % _HISTORY_HEARTBEAT_EVERY == 0:
                    log(f"  walked {commits:,} commits…")
                    ticks.send({"stage": TimelineStage.HISTORY, "commits": commits})
                continue
            if not line.startswith(":") or cur is None:
                continue
            # ":<mode> <mode> <sha_before> <sha_after> <status>\t<path>"
            meta, tab, path = line[1:].partition("\t")
            if not tab:
                continue
            parts = meta.split()
            if len(parts) < 5:
                continue
            mode_after, sha_after, status = parts[1], parts[3], parts[4]
            # Symlinks/submodules are excluded like the live scan; recording as a
            # deletion (not a drop) also pops any pre-typechange regular-file content.
            if mode_after in ("120000", "160000"):
                cur.changes.append((path, None))
                continue
            deleted = status.startswith("D") or sha_after.strip("0") == ""
            cur.changes.append((path, None if deleted else sha_after))
    finally:
        # kill before wait: a full stdout pipe would otherwise deadlock git
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    log(f"  done — {commits:,} commits walked")
    # Forced: the true total must land even if the last tick fell inside the
    # throttle window, or the row sits on a stale count for the rest of the run.
    ticks.send({"stage": TimelineStage.HISTORY, "commits": commits}, force=True)
    newest_first.reverse()
    return newest_first


def _collect_blob_tables(
    root: Path,
    deltas: list[CommitDelta],
    *,
    use_cache: bool = True,
    on_progress: OnTimelineProgress | None = None,
) -> tuple[dict[str, int | None], dict[str, int | None], dict[str, BlobEntry]]:
    """Resolve every touched blob's stats (lines, binary, binaryType, media dims)
    keyed by sha, plus a byte-size table. Stats share reconstruct_manifest's
    content-addressed resolver; sizes are a separate uncached batch. The done
    tick lands after that size batch, which is the rest of this stage's real
    work."""
    wanted = [(sha, path) for d in deltas for path, sha in d.changes if sha]
    shas = list({sha for sha, _ in wanted})
    total = len(shas)

    def _resolved(done: int, _total: int) -> None:
        if on_progress is not None:
            on_progress({"stage": TimelineStage.BLOBS, "done": done, "total": total})

    blob_stats = resolve_blob_stats(
        root, wanted, use_cache=use_cache, on_resolved=_resolved
    )
    lines: dict[str, int | None] = {
        sha: entry["lines"] for sha, entry in blob_stats.items()
    }
    # git-lfs: prefer the resolved size; blob_sizes_batch sees only the pointer.
    sizes: dict[str, int | None] = dict(blob_sizes_batch(root, shas))
    for sha, entry in blob_stats.items():
        if "size" in entry:
            sizes[sha] = entry["size"]
    if on_progress is not None:
        on_progress({"stage": TimelineStage.BLOBS, "done": total, "total": total})
    return lines, sizes, blob_stats


def build_union_manifest(
    root: Path,
    source: SourceRef,
    deltas: list[CommitDelta],
    blob_lines: dict[str, int | None],
    blob_sizes: dict[str, int | None],
    blob_stats: dict[str, BlobEntry],
    commits: list[CommitEntry],
    git_created: dict[str, str],
    git_modified: dict[str, str],
) -> Manifest:
    """City for the union of every path that ever existed. Each file's footprint
    `size` (and placeholder `lines`) is its MAX over history; binary/binaryType/
    media dims come from that largest-seen version's blob stats, so a binary file
    renders as a data building in Timeline exactly as it does live. created/
    modified come from the same full-ISO maps reconstruct_manifest uses. Flows
    through the SHARED tree builder + build_file_node so the layout matches every
    per-commit reconstruction it will be scrubbed against."""
    # Every path that ever existed, including one whose every version is a blob
    # the backfill skipped: it belongs in the city, it just has no measurements.
    seen: set[str] = set()
    max_size: dict[str, int] = {}
    max_lines: dict[str, int] = {}
    # Each path's largest-seen blob: the version whose binary/media character
    # the union node inherits, keeping it consistent with the footprint `size`.
    rep_stats: dict[str, BlobEntry] = {}
    for d in deltas:
        for path, sha in d.changes:
            if sha is None:
                continue
            seen.add(path)
            # Absent from the table means unmeasurable, not empty, so it can't
            # take part in a max: a 0 would win against nothing and read as one.
            size = blob_sizes.get(sha)
            if size is not None and (path not in max_size or size >= max_size[path]):
                max_size[path] = size
                rep_stats[path] = blob_stats.get(sha, MISSING_BLOB)
            lines = blob_lines.get(sha)
            if lines is not None:
                max_lines[path] = max(max_lines.get(path, 0), lines)

    root_abs = str(Path(root).resolve())
    children_map = dir_children_from_paths(seen)
    sig = new_signature()
    head_sha = commits[-1].sha if commits else ""

    def list_children(rel_dir: str) -> list[tuple[str, str, bool]]:
        return children_map.get(rel_dir, [])

    def make_file_node(name: str, rel_path: str) -> FileNode:
        return blob_file_node(
            sig,
            name=name,
            rel_path=rel_path,
            # None when no version of this path could be measured at all.
            size=max_size.get(rel_path),
            lines=max_lines.get(rel_path),
            stats=rep_stats.get(rel_path, MISSING_BLOB),
            created=git_created.get(rel_path, ""),
            modified=git_modified.get(rel_path, ""),
        )

    tree = build_tree(
        root_abs, ".", list_children=list_children, make_file_node=make_file_node
    )
    signals = derive_tree_signals(tree)
    repo_info = (
        reconstructed_repo_info(Path(root_abs), head_sha)
        if head_sha
        else empty_repo_info()
    )
    # Uncapped: the scrubber indexes the bundle's commits and the city the
    # union manifest's, so sampling one would slide every tree off its commit.
    return wrap_manifest(
        source, tree, sig, signals, repo_info, commits, [], sample=False
    )


def compute_commit_line_ranges(
    deltas: list[CommitDelta], blob_lines: dict[str, int | None]
) -> list[RangeStat]:
    """Per-commit line range over the present files (non-zero only) — mirrors
    compute_repo_stats, so range[HEAD] equals the live lineCountRange. The client
    normalizes height against range[pos] to match Live-at-that-commit."""
    present: dict[str, int | None] = {}  # path -> current line count
    ranges: list[RangeStat] = []
    for d in deltas:
        for path, sha in d.changes:
            if sha is None:
                present.pop(path, None)
            else:
                present[path] = blob_lines.get(sha)
        lo = hi = 0
        for n in present.values():
            # An unmeasurable blob can't widen a range it has no number for.
            if n is None or n <= 0:
                continue
            if lo == 0 or n < lo:
                lo = n
            if n > hi:
                hi = n
        ranges.append(RangeStat(min=lo, max=hi))
    return ranges


def compute_commit_date_ranges(
    deltas: list[CommitDelta],
    commits: list[CommitEntry],
    git_created: dict[str, str],
    git_modified: dict[str, str],
    *,
    on_commit: Callable[[int, int], None] | None = None,
) -> list[DateRangeMs]:
    """Per-commit created/modified ms ranges over the files present at each
    commit; range[HEAD] equals the live manifest's dateRanges (weathering
    normalizes against these). replay.ts walks the same deltas for a different
    output (per-frame scrub index) — neither is a copy of the other."""
    commit_ms = [iso_to_ms(c.date) or 0 for c in commits]
    # Parsed once per path, not per (commit, path): the loop below runs ~98M
    # times on a big repo, and re-parsing there is what made this the slow step.
    created_ms = {p: iso_to_ms(v) for p, v in git_created.items()}
    modified_ms = {p: iso_to_ms(v) for p, v in git_modified.items()}

    final_idx: dict[str, int] = {}
    genesis_idx: dict[str, int] = {}
    for i, delta in enumerate(deltas):
        for path, sha in delta.changes:
            final_idx[path] = i
            if sha is not None and path not in genesis_idx:
                genesis_idx[path] = i

    present: set[str] = set()
    last_change: dict[str, int] = {}
    ranges: list[DateRangeMs] = []
    for i, delta in enumerate(deltas):
        for path, sha in delta.changes:
            last_change[path] = i
            if sha is None:
                present.discard(path)
            else:
                present.add(path)

        min_created = min_modified = None
        max_created = max_modified = None
        for path in present:
            lm = last_change.get(path, 0)
            modified = None
            if lm >= final_idx.get(path, 0):
                modified = modified_ms.get(path)
            if modified is None:
                modified = commit_ms[lm] if lm < len(commit_ms) else 0
            created = created_ms.get(path)
            if created is None:
                gi = genesis_idx.get(path, 0)
                created = commit_ms[gi] if gi < len(commit_ms) else 0

            if min_created is None or created < min_created:
                min_created = created
            if max_created is None or created > max_created:
                max_created = created
            if min_modified is None or modified < min_modified:
                min_modified = modified
            if max_modified is None or modified > max_modified:
                max_modified = modified

        # An empty present set collapses to a zero span, which the client already
        # treats as "no spread" (freshest / newest).
        ranges.append(
            DateRangeMs(
                minCreated=min_created or 0,
                maxCreated=max_created or 0,
                minModified=min_modified or 0,
                maxModified=max_modified or 0,
            )
        )
        if on_commit is not None and i % _ASSEMBLE_HEARTBEAT_EVERY == 0:
            on_commit(i, len(deltas))
    return ranges


def build_timeline_bundle(
    root: str,
    source: SourceRef,
    *,
    use_cache: bool = True,
    extra_exclude_paths: frozenset[str] = frozenset(),
    on_progress: OnTimelineProgress | None = None,
) -> TimelineBundle:
    """Assemble the full replay bundle: commits, the union manifest, per-commit
    blob deltas, and a sha -> line-count table. Pathological repos (union above
    `_UNION_FILE_CAP`) are windowed to their most recent commits, surfaced via
    `note`. ``extra_exclude_paths`` are the user's city excludes, folded into the
    same skip filter as .codecityignore so an excluded path is absent everywhere
    (union, deltas, blobs) — the timeline equivalent of the live scan's excludes.
    ``on_progress`` threads through to the history walk + blob resolution — see
    their docstrings for the payload shape."""
    root_path = Path(root).resolve()
    if not is_git_repo(root_path):
        raise NotAGitRepoError(str(root_path))

    log(f"building timeline bundle for {root_path}")
    deltas = walk_deltas(root_path, on_progress=on_progress)
    history = collect_git_history(root_path, use_cache=use_cache)
    commits = history.commits
    # same commit set + order across both walks, so index i lines up
    assert len(deltas) == len(commits), "delta/commit walks misaligned"

    # Apply the live scan's skip filter ONCE, upstream, so every downstream
    # stage shares one filtered set.
    rules = SkipRules.load(root_path, extra_exclude_paths=extra_exclude_paths)
    deltas = [
        CommitDelta(
            sha=d.sha,
            changes=[(p, s) for p, s in d.changes if not rules.skips_path(p)],
        )
        for d in deltas
    ]

    notes: list[str] = []
    union = {p for d in deltas for p, sha in d.changes if sha}
    if len(union) > _UNION_FILE_CAP:
        kept: set[str] = set()
        cut = len(deltas)
        for i in range(len(deltas) - 1, -1, -1):
            kept |= {p for p, sha in deltas[i].changes if sha}
            if len(kept) > _UNION_FILE_CAP:
                cut = i + 1
                break
        if deltas:
            cut = min(cut, len(deltas) - 1)  # always keep the most recent commit
        deltas = deltas[cut:]
        commits = commits[cut:]
        notes.append(f"timeline covers the most recent {len(commits)} commits")

    blob_lines, blob_sizes, blob_stats = _collect_blob_tables(
        root_path, deltas, use_cache=use_cache, on_progress=on_progress
    )
    # Every non-null delta sha gets an entry so the client can't miss one. None,
    # not 0: a zero draws the file as empty at every commit it appears in.
    for d in deltas:
        for _, sha in d.changes:
            if sha is not None:
                blob_lines.setdefault(sha, None)
                blob_sizes.setdefault(sha, None)
    unmeasured = sum(1 for v in blob_sizes.values() if v is None)
    if unmeasured:
        notes.append(
            f"{unmeasured} blob(s) too large to fetch: those files show no size"
        )
    # Everything below is assembly over the whole union: minutes on a big repo,
    # and the only progress the client can show for it is what we count out.
    assemble_tick(on_progress, 1)  # the union manifest
    union_manifest = build_union_manifest(
        root_path,
        source,
        deltas,
        blob_lines,
        blob_sizes,
        blob_stats,
        commits,
        history.created,
        history.modified,
    )
    assemble_tick(on_progress, 2)  # per-commit line ranges
    commit_line_ranges = compute_commit_line_ranges(deltas, blob_lines)
    # The long one: it walks every file present at every commit, so it reports
    # from inside rather than sitting on its own step for minutes.
    assemble_tick(on_progress, 3)
    commit_date_ranges = compute_commit_date_ranges(
        deltas,
        commits,
        history.created,
        history.modified,
        on_commit=lambda i, total: assemble_tick(on_progress, 3, i / max(total, 1)),
    )
    log("timeline bundle complete")

    return TimelineBundle(
        commits=commits,
        unionManifest=union_manifest,
        deltas=[
            TimelineDelta(
                sha=d.sha,
                changes=[TimelineChange(path=p, sha=s) for p, s in d.changes],
            )
            for d in deltas
        ],
        blobLines=blob_lines,
        blobSizes=blob_sizes,
        commitLineRanges=commit_line_ranges,
        commitDateRanges=commit_date_ranges,
        notes=notes,
    )
