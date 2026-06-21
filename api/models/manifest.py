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
    created: str = Field(
        description=(
            "ISO create date (UTC, Z-suffixed), resolved server-side: git "
            "history date when the file has one, filesystem date otherwise"
        )
    )
    modified: str = Field(
        description=(
            "ISO modify date (UTC, Z-suffixed), resolved server-side: git "
            "history date when the file has one, filesystem date otherwise"
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

    @model_validator(mode="after")
    def _media_both_or_neither(self) -> "FileNode":
        if (self.media_width is None) != (self.media_height is None):
            raise ValueError(
                "media_width and media_height must both be set or both absent"
            )
        return self


class ExtBreakdownEntry(BaseModel):
    ext: str
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
    date: str = Field(description="YYYY-MM-DD")
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
    file_count: int


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
    maxMediaPixelsFile: Optional[FileLeader]
    mediaCount: int
    totalLines: int
    codeBytes: int
    maxDepthDir: Optional[DirLeader]
    maxFilesPerDir: Optional[DirLeader]
    maxFilesPerCommit: Optional[CommitLeader]
    minFilesPerCommit: Optional[CommitLeader]
    commitDates: CommitDateRange
    maxCommitsPerDay: Optional[DayLeader]
    maxCommitStreakDays: int
    authors: list[AuthorStat]


class Manifest(BaseModel):
    root: str
    scanned_at: str
    signature: str
    tree_signature: str
    tree: DirNode
    repo: RepoInfo
    commits: list[CommitEntry]
    busyness: BusynessThresholds
    dateRanges: DateRanges
    stats: RepoStats
    # Optional-but-non-nullable (absent for local sources, a label string for
    # git sources — never null); see OptionalStr above.
    display_root: OptionalStr = None


class SignatureResponse(BaseModel):
    root: str
    scanned_at: str
    signature: str


DirNode.model_rebuild()
