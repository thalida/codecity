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


class Manifest(TypedDict):
    """Top-level manifest emitted by scan_tree(). What /api/manifest
    returns and what the web app's CityScene.applyManifest consumes."""

    root: str
    scanned_at: str
    signature: str
    tree: DirNode
    repo: RepoInfo | None
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
