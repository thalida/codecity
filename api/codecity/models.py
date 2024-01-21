from datetime import datetime
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, Tag
from typing_extensions import Annotated

subclass_registry = {}


class CodeCityRevisionStats(BaseModel):
    num_commits: int = Field(ge=0)
    num_contributors: int = Field(ge=0)
    last_commit_time: datetime | None
    first_commit_time: datetime | None


class CodeCityRepoOverview(BaseModel):
    url: str
    id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    description_html: Optional[str] = None
    homepage_url: Optional[str] = None
    stargazer_count: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CodeCityTreeNode(BaseModel):
    node_type: Literal["tree"] = "tree"

    child_paths: list[str]
    num_children: int = Field(ge=0)
    num_descendants: int = Field(ge=0)
    num_child_blobs: int = Field(ge=0)
    num_child_trees: int = Field(ge=0)

    depth: int = Field(ge=0)
    parent_path: str | None
    path: str
    name: str
    revision_stats: CodeCityRevisionStats | None


class CodeCityBlobNode(BaseModel):
    node_type: Literal["blob"] = "blob"

    suffix: str | None
    suffixes: list[str] | None
    mime_type: str
    size: int
    num_lines: int | None

    depth: int = Field(ge=0)
    parent_path: str | None
    path: str
    name: str
    revision_stats: CodeCityRevisionStats | None


CodeCityNode = Annotated[
    Union[
        CodeCityTreeNode,
        CodeCityBlobNode,
    ],
    Field(
        discriminator="node_type",
    ),
]


class CodeCityRootTree(BaseModel):
    root_path: str
    nodes: dict[str, CodeCityNode] = Field(
        default_factory=dict,
        description="A mapping of node paths to node objects.",
    )


class CodeCityResponse(BaseModel):
    repo: CodeCityRepoOverview
    tree: CodeCityRootTree
