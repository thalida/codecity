"""Timeline bundle: one git-history walk → per-commit blob deltas, replayed
client-side for smooth scrubbing. Read-only; reuses gitobj's git plumbing."""

from __future__ import annotations

import hashlib
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, NamedTuple

from api.cache import BlobEntry, blob_entry, cache_load_blobs, cache_save_blobs
from api.git.objects import _git_argv, blob_sizes_batch, blob_stats_batch
from api.manifest_types import (
    CommitEntry,
    DateRangeMs,
    FileNode,
    Manifest,
    RangeStat,
    TimelineBundle,
)
from api.media import media_kind
from api.models.events import TimelineStage
from api.scan.filemeta import basename, extension
from api.git.meta import collect_git_history, is_git_repo, reconstructed_repo_info
from api.scan.manifest import wrap_manifest
from api.progress import SCAN_PROGRESS_THROTTLE_S, log
from api.errors import NotAGitRepoError
from api.scan.signatures import derive_tree_signals, hash_file_entry
from api.scan.skiprules import SkipRules
from api.scan.treebuild import build_file_node, build_tree, dir_children_from_paths

_UNION_FILE_CAP = 50000  # union files above this window to the most recent commits

# Progress payload: a TimelineStage plus that stage's counters (commits, or
# done/total). The router translates it into the wire TimelineProgressEvent.
OnTimelineProgress = Callable[[dict[str, object]], None]

_HISTORY_HEARTBEAT_EVERY = 2000  # commits between progress ticks

# Assembly's four steps, each owning a quarter of the reported percent. The last
# is the router's: serialising the bundle onto the wire is the step nothing else
# can report. A percent, not a step name — what the steps are called is this
# module's business, and the client's row wants a number like the rows above it.
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
    argv = _git_argv(
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
    last_emit = 0.0
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
                    if on_progress is not None:
                        now = time.monotonic()
                        if now - last_emit >= SCAN_PROGRESS_THROTTLE_S:
                            on_progress(
                                {"stage": TimelineStage.HISTORY, "commits": commits}
                            )
                            last_emit = now
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
    if on_progress is not None:
        on_progress(
            {"stage": TimelineStage.HISTORY, "commits": commits}
        )  # final, unthrottled
    newest_first.reverse()
    return newest_first


def _collect_blob_tables(
    root: Path,
    deltas: list[CommitDelta],
    *,
    use_cache: bool = True,
    on_progress: OnTimelineProgress | None = None,
) -> tuple[dict[str, int], dict[str, int], dict[str, BlobEntry]]:
    """Resolve every touched blob's stats (lines, binary, binaryType, media dims)
    keyed by sha, plus a byte-size table. Stats go through the same content-
    addressed blob cache reconstruct_manifest uses (cat-file only the misses);
    sizes are a separate uncached batch. The blob-check batch resolves the total
    up front, so ``on_progress`` only needs a start + done tick — the done tick
    lands after the size batch, which is the rest of this stage's real work."""
    shas = list({sha for d in deltas for _, sha in d.changes if sha})
    total = len(shas)
    media_shas = frozenset(
        sha
        for d in deltas
        for path, sha in d.changes
        if sha and media_kind(extension(basename(path)))
    )
    cached = cache_load_blobs(root) if use_cache else {}
    misses = [s for s in shas if s not in cached]
    log(f"resolving {len(misses):,}/{total:,} blobs ({total - len(misses):,} cached)…")
    if on_progress is not None:
        on_progress(
            {"stage": TimelineStage.BLOBS, "done": total - len(misses), "total": total}
        )
    fresh = blob_stats_batch(root, misses, media_shas=media_shas) if misses else {}
    for sha, st in fresh.items():
        cached[sha] = blob_entry(st)
    if fresh:
        cache_save_blobs(root, cached)
    log(f"  done — {total:,} blobs resolved")
    lines = {s: cached[s]["lines"] for s in shas if s in cached}
    # git-lfs: prefer the resolved size; blob_sizes_batch sees only the pointer.
    sizes = blob_sizes_batch(root, shas)
    for s in shas:
        entry = cached.get(s)
        if entry is not None and "size" in entry:
            sizes[s] = entry["size"]
    blob_stats = {s: cached[s] for s in shas if s in cached}
    if on_progress is not None:
        on_progress({"stage": TimelineStage.BLOBS, "done": total, "total": total})
    return lines, sizes, blob_stats


def build_union_manifest(
    root: Path,
    deltas: list[CommitDelta],
    blob_lines: dict[str, int],
    blob_sizes: dict[str, int],
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
    max_size: dict[str, int] = {}
    max_lines: dict[str, int] = {}
    # Stats of each path's largest-seen blob — the representative version whose
    # binary/media character the union node inherits (binary-ness is stable per
    # file, so any version's flag is fine; the largest keeps it consistent with
    # the footprint `size`).
    rep_stats: dict[str, BlobEntry] = {}
    for d in deltas:
        for path, sha in d.changes:
            if sha is None:
                continue
            size = blob_sizes.get(sha, 0)
            if path not in max_size or size >= max_size[path]:
                max_size[path] = size
                rep_stats[path] = blob_stats.get(sha, {"lines": 0, "binary": False})
            max_lines[path] = max(max_lines.get(path, 0), blob_lines.get(sha, 0))

    root_abs = str(Path(root).resolve())
    children_map = dir_children_from_paths(max_size.keys())
    sig = hashlib.blake2b(digest_size=16)

    def list_children(rel_dir: str) -> list[tuple[str, str, bool]]:
        return children_map.get(rel_dir, [])

    def make_file_node(name: str, rel_path: str) -> FileNode:
        size = max_size.get(rel_path, 0)
        hash_file_entry(sig, rel_path, size, 0.0, False)
        st = rep_stats.get(rel_path, {"lines": 0, "binary": False})
        return build_file_node(
            name=name,
            rel_path=rel_path,
            full_path=f"{root_abs}/{rel_path}",
            ext=extension(name),
            size=size,
            lines=max_lines.get(rel_path, 0),
            binary=st["binary"],
            dirty=False,
            created=git_created.get(rel_path, ""),
            modified=git_modified.get(rel_path, ""),
            media_width=st.get("media_width"),
            media_height=st.get("media_height"),
            binary_type=st.get("binaryType"),
        )

    tree = build_tree(
        root_abs, ".", list_children=list_children, make_file_node=make_file_node
    )
    signals = derive_tree_signals(tree)
    head_sha = commits[-1]["sha"] if commits else ""
    repo_info = (
        reconstructed_repo_info(Path(root_abs), head_sha)
        if head_sha
        else {
            "branch": None,
            "remote_url": None,
            "head_sha": None,
            "head_subject": None,
            "dirty": False,
        }
    )
    # Uncapped: the scrubber indexes the bundle's commits and the city the
    # union manifest's, so sampling one would slide every tree off its commit.
    return wrap_manifest(
        root_abs, tree, sig, signals, repo_info, commits, [], sample=False
    )


def compute_commit_line_ranges(
    deltas: list[CommitDelta], blob_lines: dict[str, int]
) -> list[RangeStat]:
    """Per-commit line range over the present files (non-zero only) — mirrors
    compute_repo_stats, so range[HEAD] equals the live lineCountRange. The client
    normalizes height against range[pos] to match Live-at-that-commit."""
    present: dict[str, int] = {}  # path -> current line count
    ranges: list[RangeStat] = []
    for d in deltas:
        for path, sha in d.changes:
            if sha is None:
                present.pop(path, None)
            else:
                present[path] = blob_lines.get(sha, 0)
        lo = hi = 0
        for n in present.values():
            if n <= 0:
                continue
            if lo == 0 or n < lo:
                lo = n
            if n > hi:
                hi = n
        ranges.append({"min": lo, "max": hi})
    return ranges


def _iso_ms(value: str | None) -> int | None:
    """Epoch ms for a Z-suffixed UTC stamp, or None. Semantics match JS
    Date.parse, since these values are compared against client-side dates."""
    if not value:
        return None
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    return int(parsed.replace(tzinfo=timezone.utc).timestamp() * 1000)


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
    commit_ms = [_iso_ms(c["date"]) or 0 for c in commits]
    # Parsed once per path, not once per (commit, path): the inner loop below
    # runs commits x files-present times, ~98M on a big repo, and re-parsing an
    # ISO stamp that many times is most of what made this the slowest step.
    created_ms = {p: _iso_ms(v) for p, v in git_created.items()}
    modified_ms = {p: _iso_ms(v) for p, v in git_modified.items()}

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
            {
                "minCreated": min_created or 0,
                "maxCreated": max_created or 0,
                "minModified": min_modified or 0,
                "maxModified": max_modified or 0,
            }
        )
        if on_commit is not None and i % _ASSEMBLE_HEARTBEAT_EVERY == 0:
            on_commit(i, len(deltas))
    return ranges


def build_timeline_bundle(
    root: str,
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

    note = None
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
        note = f"timeline covers the most recent {len(commits)} commits"

    blob_lines, blob_sizes, blob_stats = _collect_blob_tables(
        root_path, deltas, use_cache=use_cache, on_progress=on_progress
    )
    # Contract: every non-null delta sha needs blobLines/blobSizes entries (default 0) so the client can't KeyError.
    for d in deltas:
        for _, sha in d.changes:
            if sha is not None:
                blob_lines.setdefault(sha, 0)
                blob_sizes.setdefault(sha, 0)
    # Everything below is assembly over the whole union: minutes on a big repo,
    # and the only progress the client can show for it is what we count out.
    assemble_tick(on_progress, 1)  # the union manifest
    union_manifest = build_union_manifest(
        root_path,
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

    return {
        "commits": commits,
        "unionManifest": union_manifest,
        "deltas": [
            {"sha": d.sha, "changes": [{"path": p, "sha": s} for p, s in d.changes]}
            for d in deltas
        ],
        "blobLines": blob_lines,
        "blobSizes": blob_sizes,
        "commitLineRanges": commit_line_ranges,
        "commitDateRanges": commit_date_ranges,
        "note": note,
    }
