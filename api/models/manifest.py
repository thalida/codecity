"""The manifest, defined once.

These models are what the scanner builds, what the caches persist, what the SSE
stream serialises, and what the OpenAPI schema — and from it
app/src/types/manifest.generated.ts — is generated from. There is no second
definition to keep in step."""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, WithJsonSchema, model_validator

# Optional-but-non-nullable: may be absent, never null when present. The two
# kinds of optional here are not interchangeable — see the README.
OptionalInt = Annotated[Optional[int], WithJsonSchema({"type": "integer"})]
OptionalStr = Annotated[Optional[str], WithJsonSchema({"type": "string"})]

# A scan stage a manifest can still be waiting on; see Manifest.pending.
ScanStage = Literal["metadata", "history"]


class NodeKind:
    """String constants matching app/types/manifest.ts:NodeKind. A plain class
    with string attrs rather than an enum.Enum so the Literal discriminators on
    FileNode/DirNode can reference them as bare string literals."""

    FILE = "file"
    DIRECTORY = "directory"


class FileNode(BaseModel):
    name: str
    type: Literal["file"]
    path: str
    extension: str
    # Required-nullable (see README): null is NOT KNOWN, never zero, which an
    # empty file already means. Only Timeline's union manifest emits it.
    size: Optional[int]
    lines: Optional[int]
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
    # Friendly magic-byte type ("SQLite database"), absent for non-binary or
    # unrecognized files. See utils/binfmt.py:detect_binary_type.
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


# Required-nullable: the scanner always emits all four, null for a fresh repo
# with no HEAD or no remote.
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


# Required-nullable: always emitted, null for a tree with zero files. camelCase
# matches the frontend's DateRanges.
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
    # A directory has no timestamps of its own, so it takes its subtree's:
    # the oldest file created under it, and the newest change anywhere in it.
    created: Optional[str]
    modified: Optional[str]


class CommitLeader(BaseModel):
    sha: str
    files: int
    # The commit's own date, so a leader can be shown by when it happened
    # rather than only by what it changed.
    date: str


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
    oldestCreatedDir: Optional[DirLeader]
    newestCreatedDir: Optional[DirLeader]
    maxFilesPerCommit: Optional[CommitLeader]
    minFilesPerCommit: Optional[CommitLeader]
    oldestCommit: Optional[CommitLeader]
    newestCommit: Optional[CommitLeader]
    commitCount: int = Field(
        description="Commits in the full history, however many `commits` carries"
    )
    commitDates: CommitDateRange
    maxCommitsPerDay: Optional[DayLeader]
    maxCommitStreakDays: int
    authors: list[AuthorStat]


# Three signatures, each a superset of the one before; what computes them and
# why they must agree across build paths is in api/scan/README.md.
class Manifest(BaseModel):
    src: str = Field(
        description=(
            "The source this describes, as passed to /api/manifest. Every path "
            "in the manifest is relative to it, and reads send it back so the "
            "server can resolve the root again (api/routers/README.md)."
        )
    )
    branch: Optional[str] = Field(
        description="Branch as passed alongside `src`, or null if none was"
    )
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
    pending: list[ScanStage] = Field(
        description=(
            "Stages still to come. 'metadata': per-file lines/binary are "
            "placeholders. 'history': dates are filesystem dates and commits is "
            "empty. Empty list means every field is final."
        )
    )
    readmePath: Optional[str] = Field(
        description="Repo-relative path of the root README, or null if there isn't one"
    )
    readmeModified: Optional[str] = Field(
        description="That README's mtime, for cache-busting the fetch"
    )


class SignatureResponse(BaseModel):
    scanned_at: str
    content_signature: str


class TimelineChange(BaseModel):
    path: str
    sha: Optional[str] = Field(description="New blob sha, or null when deleted")


class TimelineDelta(BaseModel):
    sha: str
    changes: list[TimelineChange]


class TimelineBundle(BaseModel):
    """Everything the client replays for smooth commit scrubbing: commit list,
    union-of-all-paths manifest (the layout target), per-commit blob deltas,
    sha -> line-count and sha -> byte-size tables, and per-commit line ranges
    (height normalisation, so a scrub point matches Live-at-that-commit).
    `notes` are standing caveats about the bundle: a pathological repo windowed
    to its most recent commits, blobs too large to have been backfilled. A list
    because they are independent and a repo can earn both."""

    commits: list[CommitEntry]
    unionManifest: Manifest
    deltas: list[TimelineDelta]
    # Every delta sha has an entry so the client can't miss one; the VALUE is
    # null when the blob was never fetched, which is not a zero (see FileNode).
    blobLines: dict[str, Optional[int]]
    blobSizes: dict[str, Optional[int]]
    commitLineRanges: list[RangeStat]
    notes: list[str]


DirNode.model_rebuild()
