"""Scanner-internal TypedDict shapes for the JSON manifest it builds.

These are the dict shapes the scanner constructs and walks INTERNALLY
during a scan. The wire/OpenAPI source of truth is `api/models/`
(Pydantic) — this TypedDict/Pydantic duplication is intentional: the
scanner builds plain dicts (fast, no validation), the API layer
re-projects them through Pydantic for the response schema.

Mirrors app/types/manifest.ts. Keep both in sync — the web app consumes
the JSON exactly as these TypedDicts describe it. Drift here is shape
drift in the wire format and will be caught by pyright on the Python
side and tsc on the TS side, but only within each language.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class NodeKind:
    """String constants matching app/types/manifest.ts:NodeKind. Plain
    class with string attrs (not enum.Enum) so the Literal discriminators
    on FileNode/DirNode can reference them as bare string literals —
    enum.StrEnum doesn't narrow as cleanly through TypedDict Literal."""

    FILE = "file"
    DIRECTORY = "directory"


class GitMeta(TypedDict):
    """Git history dates for a file. ISO 8601 strings; null when the
    scanner never observed a create/modify date (e.g. uncommitted)."""

    created: str | None
    modified: str | None


class FileNode(TypedDict):
    """One file in the manifest tree. The Literal on `type` makes the
    union with DirNode a discriminated union — pyright narrows on
    `node["type"] == "file"`."""

    name: str
    type: Literal["file"]
    path: str
    fullPath: str
    extension: str
    size: int
    lines: int
    binary: bool
    created: str
    modified: str
    git: GitMeta
    # Optional pixel dimensions for recognized media files (png/jpg/svg/
    # mp4/etc.). Either both keys appear together or neither does. Layout
    # uses these to size the building's silhouette; absence triggers a
    # 1:1 aspect fallback. See api/media.py.
    media_width: NotRequired[int]
    media_height: NotRequired[int]


class ExtBreakdownEntry(TypedDict):
    """One file-extension bucket within a directory's descendant breakdown.
    `ext` is the lowercase extension (e.g. ".ts") or "(none)" for files with
    no extension. Computed once during the tree walk so the UI's street view
    reads it instead of re-walking the subtree on every selection."""

    ext: str
    count: int
    size: int


class DirNode(TypedDict):
    """One directory in the manifest tree. children may be empty."""

    name: str
    type: Literal["directory"]
    path: str
    fullPath: str
    children: list["TreeNode"]
    children_count: int
    children_file_count: int
    children_dir_count: int
    descendants_count: int
    descendants_file_count: int
    descendants_dir_count: int
    descendants_size: int
    # Per-extension counts/sizes aggregated over ALL descendant files,
    # sorted by count desc (ext asc tiebreak). Baked here so the street
    # view reads it directly. Empty list for directories with no files.
    descendants_ext_breakdown: list[ExtBreakdownEntry]


TreeNode = FileNode | DirNode


class RepoInfo(TypedDict):
    """Repo-level git metadata surfaced in the footer (branch, remote
    link, dirty marker, last commit). All fields nullable because a
    fresh repo with no commits yet has no HEAD; a repo with no remote
    has no URL."""

    branch: str | None
    remote_url: str | None
    head_sha: str | None
    head_subject: str | None
    dirty: bool


class CommitEntry(TypedDict):
    """One commit within the git lookback window. Emitted in
    oldest-first order so consumers can map commits[i] → i-th tree
    placement (closest-to-gem). Date is day-precision for compact
    payload + future age signal. files = count of A/M/D/T/U rows in
    the commit's --name-status block. sha is the full 40-char hex;
    the UI displays the first 7. authors is the deduped list of
    distinct authors for this commit — primary (git's %an) at index 0,
    Co-authored-by trailer names following. Emails stripped (privacy).
    subject is git %s — the first line of the commit message only;
    body is fetched lazily via /api/commit. same_day_total is the number
    of commits sharing this commit's calendar date (>= 1, includes self),
    baked once at manifest-wrap so the commit pane's busyness badge and the
    scene tree-color both read one consistent value instead of each
    recomputing the per-day grouping."""

    date: str   # "YYYY-MM-DD"
    files: int
    sha: str
    authors: list[str]
    subject: str
    # NotRequired: derived field, absent when commits are first collected/
    # loaded from cache; baked in-place by _annotate_same_day_totals at
    # manifest-wrap (always before any emit). Required on the wire model.
    same_day_total: NotRequired[int]


class BusynessThresholds(TypedDict):
    """Repo-relative per-day commit-count thresholds (commits/day), computed
    once from the commit history. A day with >= busy commits reads as "Busy",
    >= avg as "Average", else "Quiet". The scene tree-color gradient and the
    commit pane's label both read these, so a busy day looks consistent in
    both. `avg` is the median commits/day (over days with >= 1 commit); `busy`
    is the 75th percentile, clamped to avg+1 so the bands stay distinct."""

    avg: int
    busy: int


class Manifest(TypedDict):
    """Top-level manifest emitted by scan_tree(). What /api/manifest
    returns and what the web app's CityScene.applyManifest consumes."""

    root: str
    scanned_at: str
    signature: str
    tree_signature: str
    tree: DirNode
    repo: RepoInfo
    commits: list[CommitEntry]
    busyness: BusynessThresholds
    display_root: NotRequired[str]


class SignatureResponse(TypedDict):
    """Cheap fingerprint of the tree, returned by /api/manifest/signature.

    Equivalent to Manifest's top-level minus `tree` and `repo`. The
    signature value is byte-identical to the one scan_tree() produces
    for the same root — that's the contract the live-update poll relies
    on."""

    root: str
    scanned_at: str
    signature: str


class ScanStreamEvent(TypedDict):
    """One NDJSON event emitted by scan_tree_streaming.

    `phase` distinguishes the early skeleton emission (tree only,
    placeholder metadata) from the final emission (full metadata).
    Both carry a complete Manifest envelope; the skeleton's tree has
    placeholder line counts that the final's tree replaces."""

    phase: Literal["skeleton", "final"]
    manifest: Manifest
