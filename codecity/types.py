"""TypedDict shapes for the JSON manifest the scanner emits.

Mirrors web/types/manifest.ts. Keep both files in sync — the web app
consumes the JSON exactly as these TypedDicts describe it. Drift here
is shape drift in the wire format and will be caught by pyright on
the Python side and tsc on the TS side, but only within each language.

A future shared JSON-Schema (or codegen) would close the cross-language
gap; for now the contract is enforced by code review + matching field
names + the file_node / build_tree return annotations.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class NodeKind:
    """String constants matching web/types/manifest.ts:NodeKind. Plain
    class with string attrs (not enum.Enum) so the Literal discriminators
    on FileNode/DirNode can reference them as bare string literals —
    enum.StrEnum doesn't narrow as cleanly through TypedDict Literal."""

    FILE = "file"
    DIRECTORY = "directory"


class GitMeta(TypedDict):
    """Git history dates for a file. ISO 8601 strings; null when the
    file isn't tracked or the field couldn't be derived."""

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
    git: GitMeta | None
    # Optional pixel dimensions for recognized media files (png/jpg/svg/
    # mp4/etc.). Either both keys appear together or neither does. Layout
    # uses these to size the building's silhouette; absence triggers a
    # 1:1 aspect fallback. See codecity/media.py.
    media_width: NotRequired[int]
    media_height: NotRequired[int]


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


TreeNode = FileNode | DirNode


class RepoInfo(TypedDict):
    """Repo-level git metadata surfaced in the footer (branch, remote
    link, dirty marker, last commit). All fields nullable because a
    fresh repo with no commits yet has no HEAD; a repo with no remote
    has no URL. None for non-git roots — see Manifest.repo."""

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
    the UI displays the first 7."""

    date: str   # "YYYY-MM-DD"
    files: int
    sha: str


class Manifest(TypedDict):
    """Top-level manifest emitted by scan_tree(). What /api/manifest
    returns and what the web app's CityScene.applyManifest consumes."""

    root: str
    scanned_at: str
    signature: str
    tree_signature: str
    tree: DirNode
    repo: RepoInfo | None
    commits: list[CommitEntry] | None
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


# ── Server response shapes ──────────────────────────────────────────────


class ErrorResponse(TypedDict):
    """Generic JSON error body. Used by most server.py error returns."""

    error: str


class FileTooLargeResponse(TypedDict):
    """413-style error from /api/file when a file exceeds MAX_FILE_BYTES."""

    error: str
    size: int
    limit: int


class CacheClearResponse(TypedDict):
    """Body of DELETE /api/manifest/cache — reports how many cached
    manifest files were removed for the requested source."""

    deleted: int


class HealthResponse(TypedDict):
    """/api/health body."""

    ok: bool


class ScanStreamEvent(TypedDict):
    """One NDJSON event emitted by scan_tree_streaming.

    `phase` distinguishes the early skeleton emission (tree only,
    placeholder metadata) from the final emission (full metadata).
    Both carry a complete Manifest envelope; the skeleton's tree has
    placeholder line counts that the final's tree replaces."""

    phase: Literal["skeleton", "final"]
    manifest: Manifest


class ScanErrorEvent(TypedDict):
    """Emitted only if a scan fails AFTER the response body has started
    streaming. Errors before the first byte use the standard 500-JSON
    path via _send_json, not this event."""

    phase: Literal["error"]
    error: str


# ── Cache shapes ────────────────────────────────────────────────────────


class FileEntry(TypedDict):
    """One entry in the per-root file-stat cache. (size, mtime) is the
    cache key; (lines, binary, ext) are the values warm scans skip
    recomputing. media_width/media_height are only present for
    recognized media files."""

    # Required (always present in a valid entry):
    size: int
    mtime: float
    lines: int
    binary: bool
    ext: str
    # Optional — populated only for recognized media files. Either both
    # or neither is present; layout treats absence as "no signal" and
    # falls back to a square aspect.
    media_width: NotRequired[int]
    media_height: NotRequired[int]


# ── Errors ──────────────────────────────────────────────────────────────


class ScanCancelledError(Exception):
    """Raised when a scan_tree cancel_event is set mid-scan.

    The server's disconnect watchdog sets the event, the scanner
    polls it at every phase boundary, and the server's outer try/
    except catches this so cancellation isn't surfaced as a 5xx."""


class CloneError(RuntimeError):
    """Generic git clone/update failure. Subclasses below differentiate
    the user-facing causes so the server can return a clean 4xx with a
    helpful message instead of bubbling raw git stderr."""


class BranchNotFoundError(CloneError):
    """User asked for a branch that doesn't exist on the remote."""


class RepoNotFoundError(CloneError):
    """Remote URL doesn't exist, is private + unauthenticated, or was
    typo'd."""


class HostUnreachableError(CloneError):
    """DNS / network failure reaching the remote host."""
