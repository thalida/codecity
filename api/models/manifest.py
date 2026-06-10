"""Pydantic wire models for the scan manifest. Single source of truth for
the OpenAPI schema and the generated app/src/types/manifest.ts. JSON shape
is byte-compatible with the prior TypedDicts."""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator


class GitMeta(BaseModel):
    created: Optional[str] = Field(None, description="ISO create date or null")
    modified: Optional[str] = Field(None, description="ISO modify date or null")


class FileNode(BaseModel):
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
    media_width: Optional[int] = None
    media_height: Optional[int] = None

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


class RepoInfo(BaseModel):
    branch: Optional[str] = None
    remote_url: Optional[str] = None
    head_sha: Optional[str] = None
    head_subject: Optional[str] = None
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


class Manifest(BaseModel):
    root: str
    scanned_at: str
    signature: str
    tree_signature: str
    tree: DirNode
    repo: RepoInfo
    commits: list[CommitEntry]
    busyness: BusynessThresholds
    display_root: Optional[str] = None


class SignatureResponse(BaseModel):
    root: str
    scanned_at: str
    signature: str


DirNode.model_rebuild()
