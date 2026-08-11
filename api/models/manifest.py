"""Pydantic wire models for the scan manifest. Single source of truth for
the OpenAPI schema and the generated app/src/types/manifest.ts. JSON shape
is byte-compatible with the prior TypedDicts."""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, WithJsonSchema, model_validator

# Optional-but-non-nullable: the field may be absent, but when present is never
# null. The Python type stays Optional (so the default is None and validators
# can check `is None`), while the emitted JSON schema is the bare non-nullable
# type — matching the true wire (absent-or-value, never null). Shared with
# api/models/events.py.
OptionalInt = Annotated[Optional[int], WithJsonSchema({"type": "integer"})]
OptionalStr = Annotated[Optional[str], WithJsonSchema({"type": "string"})]


class FileNode(BaseModel):
    name: str
    type: Literal["file"]
    path: str
    fullPath: str
    extension: str
    size: int
    lines: int
    binary: bool
    dirty: bool = Field(
        description=(
            "Working-tree differs from HEAD for this tracked file (staged or "
            "unstaged). Always False for clean/remote repos."
        )
    )
    created: str = Field(
        description=(
            "ISO create date (UTC, Z-suffixed), resolved server-side: git "
            "history date when the file has one, filesystem date otherwise"
        )
    )
    modified: str = Field(
        description=(
            "ISO modify date (UTC, Z-suffixed), resolved server-side: git "
            "history date when the file has one, filesystem date otherwise. "
            "When dirty is true, this is always the working-tree filesystem "
            "date, regardless of git history"
        )
    )
    mediaKind: Optional[Literal["image", "video"]] = Field(
        default=None,
        description=(
            "Media classification by extension (single source for the "
            "frontend); null for non-media files"
        ),
    )
    # Optional-but-non-nullable (absent for non-media files, a pixel count
    # otherwise — never null); see OptionalInt above.
    media_width: OptionalInt = None
    media_height: OptionalInt = None
    # Friendly magic-byte type for binary files ("SQLite database",
    # "WebAssembly module"); absent for non-binary or unrecognized files.
    # See api/services/binfmt.py:detect_binary_type.
    binaryType: OptionalStr = None

    @model_validator(mode="after")
    def _media_both_or_neither(self) -> "FileNode":
        if (self.media_width is None) != (self.media_height is None):
            raise ValueError(
                "media_width and media_height must both be set or both absent"
            )
        return self


class ExtBreakdownEntry(BaseModel):
    ext: str | None
    count: int
    size: int


class DirNode(BaseModel):
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
    descendants_created_min: Optional[str]
    descendants_modified_max: Optional[str]
    descendants_ext_breakdown: list[ExtBreakdownEntry]


TreeNode = Annotated[Union[FileNode, DirNode], Field(discriminator="type")]


# All four string fields are required-nullable: the scanner always emits them
# (null for a fresh repo with no HEAD / no remote), so they're present-but-
# nullable on the wire, not optional.
class RepoInfo(BaseModel):
    branch: Optional[str]
    remote_url: Optional[str]
    head_sha: Optional[str]
    head_subject: Optional[str]
    dirty: bool


class CommitEntry(BaseModel):
    date: str = Field(description="ISO-8601 UTC, e.g. 2026-07-25T14:03:21Z")
    files: int
    sha: str
    authors: list[str]
    subject: str
    same_day_total: int


class BusynessThresholds(BaseModel):
    avg: int
    busy: int


# All four fields are required-nullable: the scanner always emits them (null
# for a tree with zero files), so they're present-but-nullable on the wire,
# not optional. camelCase matches the frontend DateRanges + the fullPath
# precedent.
class DateRanges(BaseModel):
    minCreated: Optional[str] = Field(
        description="Earliest resolved create date (ISO), or null for an empty tree"
    )
    maxCreated: Optional[str] = Field(
        description="Latest resolved create date (ISO), or null for an empty tree"
    )
    minModified: Optional[str] = Field(
        description="Earliest resolved modify date (ISO), or null for an empty tree"
    )
    maxModified: Optional[str] = Field(
        description="Latest resolved modify date (ISO), or null for an empty tree"
    )


class RangeStat(BaseModel):
    min: int
    max: int


class FileLeader(BaseModel):
    path: str
    lines: int
    bytes: int
    created: str
    modified: str
    # Optional-but-non-nullable (absent for non-media leaders, a pixel count
    # otherwise — never null); see OptionalInt above.
    media_width: OptionalInt = None
    media_height: OptionalInt = None

    @model_validator(mode="after")
    def _media_both_or_neither(self) -> "FileLeader":
        if (self.media_width is None) != (self.media_height is None):
            raise ValueError(
                "media_width and media_height must both be set or both absent"
            )
        return self


class DirLeader(BaseModel):
    path: str
    depth: int
    children: int
    descendants: int


class CommitLeader(BaseModel):
    sha: str
    files: int


# Both fields required-nullable: the scanner always emits them (null for a repo
# with no commits), so they're present-but-nullable on the wire, not optional.
class CommitDateRange(BaseModel):
    oldest: Optional[str] = Field(
        description="Oldest commit date (YYYY-MM-DD), or null when the repo has no commits"
    )
    newest: Optional[str] = Field(
        description="Newest commit date (YYYY-MM-DD), or null when the repo has no commits"
    )


class DayLeader(BaseModel):
    date: str
    count: int


class AuthorStat(BaseModel):
    name: str
    commits: int
    hue: int = Field(
        description="Stable 0-359 hue from the name hash; the display colour is built from it client-side"
    )


class RepoStats(BaseModel):
    lineCountRange: RangeStat
    byteSizeRange: RangeStat
    oldestCreatedFile: Optional[FileLeader]
    newestCreatedFile: Optional[FileLeader]
    newestModifiedFile: Optional[FileLeader]
    oldestModifiedFile: Optional[FileLeader]
    maxLinesFile: Optional[FileLeader]
    minLinesFile: Optional[FileLeader]
    maxBytesFile: Optional[FileLeader]
    minBytesFile: Optional[FileLeader]
    maxMediaBytesFile: Optional[FileLeader]
    minMediaBytesFile: Optional[FileLeader]
    maxMediaPixelsFile: Optional[FileLeader]
    minMediaPixelsFile: Optional[FileLeader]
    maxBinaryBytesFile: Optional[FileLeader]
    minBinaryBytesFile: Optional[FileLeader]
    mediaCount: int
    binaryCount: int
    totalLines: int
    dirtyFileCount: int
    codeBytes: int
    maxDepthDir: Optional[DirLeader]
    maxChildrenDir: Optional[DirLeader]
    minChildrenDir: Optional[DirLeader]
    maxFilesPerCommit: Optional[CommitLeader]
    minFilesPerCommit: Optional[CommitLeader]
    commitCount: int = Field(
        description="Commits in the full history, however many `commits` carries"
    )
    commitDates: CommitDateRange
    maxCommitsPerDay: Optional[DayLeader]
    maxCommitStreakDays: int
    authors: list[AuthorStat]


# Three signatures form a ladder, each a superset of the one before:
#   structure_signature: paths + nesting only. Drives icon-atlas assignment
#     and skeleton/final render stability.
#   layout_signature: structure, plus per-file size. Gates layout reuse (a
#     size-only change can still skip a full relayout if paths didn't move).
#   content_signature: structure, plus size, mtime, dirty, and repo HEAD. The
#     full change-detection fingerprint: drives the live-update poll and is
#     the manifest cache key.
class Manifest(BaseModel):
    root: str
    scanned_at: str
    content_signature: str
    structure_signature: str
    layout_signature: str
    tree: DirNode
    repo: RepoInfo
    commits: list[CommitEntry] = Field(
        description=(
            "Oldest-first. Above 100k, an evenly strided sample of the history; "
            "stats.commitCount is the true total."
        )
    )
    busyness: BusynessThresholds
    dateRanges: DateRanges
    stats: RepoStats
    pending: list[Literal["metadata", "history"]] = Field(
        description=(
            "Stages still to come. 'metadata': per-file lines/binary are "
            "placeholders. 'history': dates are filesystem dates and commits is "
            "empty. Empty list means every field is final."
        )
    )
    readmePath: Optional[str] = Field(
        description="Absolute path of the root README, or null if there isn't one"
    )
    readmeModified: Optional[str] = Field(
        description="That README's mtime, for cache-busting the fetch"
    )


class SignatureResponse(BaseModel):
    root: str
    scanned_at: str
    content_signature: str


class DateRangeMs(BaseModel):
    minCreated: int
    maxCreated: int
    minModified: int
    maxModified: int


class TimelineChange(BaseModel):
    path: str
    sha: Optional[str] = Field(description="New blob sha, or null when deleted")


class TimelineDelta(BaseModel):
    sha: str
    changes: list[TimelineChange]


class TimelineBundle(BaseModel):
    """Wire schema for the scrub bundle; mirrors manifest_types.TimelineBundle."""

    commits: list[CommitEntry]
    unionManifest: Manifest
    deltas: list[TimelineDelta]
    blobLines: dict[str, int]
    blobSizes: dict[str, int]
    commitLineRanges: list[RangeStat]
    commitDateRanges: list[DateRangeMs]
    note: Optional[str]


DirNode.model_rebuild()
