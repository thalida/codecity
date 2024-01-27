from rich import inspect, print  # noqa: F401, I001

import base64
import os
import pathlib
from datetime import datetime, timezone
from typing import Literal, Optional, Union

import git
import requests
from pydantic import BaseModel, Field, computed_field, field_validator
from typing_extensions import Annotated
from dotenv import load_dotenv

from .utils import (
    calc_distance_ratio,
    calc_inverse_distance_ratio,
    median_datetime,
)

os.environ["TZ"] = "UTC"

load_dotenv()

GITEA_API_URL = "https://tea.gitx.codes/api/v1/"
GITEA_TOKEN = os.getenv("GITTEA_TOKEN")

CACHE_DIR = pathlib.Path(__file__).parent / "cache"
CACHE_REPO_DIR_NAME = "src"
CACHE_OVERVIEW_FILE_NAME = "overview.json"
CACHE_REPO_TREE_FILE_NAME = "repo_tree.json"
CACHE_REPO_LOGS_NAME = "repo_logs.json"
CACHE_TTL: int = 60 * 60  # 1 hour


class CodeCityRepoOverview(BaseModel):
    url: str
    name: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CodeCityRevisionStats(BaseModel):
    updated_on: datetime | None = Field(description="Last commit datetime")
    created_on: datetime | None = Field(description="First commit datetime")
    median_updated_on: datetime | None = Field(
        description="The median of all commit datetimes"
    )
    local_age: float | None = Field(
        ge=0,
        le=1,
        description="How old is the node relative to the age of the repo. A float between 0 and 1, where 0 is new and 1 is old.",
    )
    local_maintenance: float | None = Field(
        ge=0,
        le=1,
        description="How active is this node, based on last commit, relative to the last commit in the repo. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.",
    )
    local_median_maintenance: float | None = Field(
        ge=0,
        le=1,
        description="How active is this node, based on median commit datetime, relative to the last commit in the repo. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.",
    )
    global_age: float | None = Field(
        ge=0,
        le=1,
        description="How old is the node relative to the current date. A float between 0 and 1, where 0 is new and 1 is old.",
    )
    global_maintenance: float | None = Field(
        ge=0,
        le=1,
        description="How active is this node, based on last commit, relative to current date. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.",
    )
    global_median_maintenance: float | None = Field(
        ge=0,
        le=1,
        description="How active is this node, based on median commit datetime, relative to current date. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.",
    )


class BaseCodeCityNode(BaseModel):
    path: str
    name: str
    parent_path: pathlib.Path | None
    ancestor_paths: list[pathlib.Path] | None
    depth: int = Field(ge=0)
    revision_stats: CodeCityRevisionStats


class CodeCityTreeNode(BaseCodeCityNode):
    node_type: Literal["tree"]

    is_root: bool = False
    num_child_blobs: int = Field(ge=0)
    num_child_trees: int = Field(ge=0)


class CodeCityBlobNode(BaseCodeCityNode):
    node_type: Literal["blob"]

    suffix: str | None
    suffixes: list[str] | None
    num_lines: int | None


CodeCityNode = Annotated[
    Union[
        CodeCityTreeNode,
        CodeCityBlobNode,
    ],
    Field(
        discriminator="node_type",
    ),
]


class CodeCity(BaseModel):
    repo_url: str

    @field_validator("repo_url")
    @classmethod
    def repo_url_is_valid_remote(cls, repo_url: str) -> str:
        git_cmd = git.cmd.Git()
        with git_cmd.custom_environment(GIT_TERMINAL_PROMPT="0"):
            try:
                git_cmd.ls_remote(repo_url)
                return repo_url
            except Exception:
                raise ValueError("Invalid repo url")

    @computed_field(return_type=str, repr=False)
    @property
    def _internal_repo_name(self):
        domain = self.repo_url.split("://")[1].split("/")[0]
        return f"{domain}__{self.repo_url.split('/')[-1]}"

    @computed_field(return_type=str, repr=False)
    @property
    def _safe_repo_url(self):
        return base64.b64encode(self.repo_url.encode("utf-8")).decode("utf-8")

    @computed_field(return_type=pathlib.Path, repr=False)
    @property
    def _cache_dir(self) -> pathlib.Path:
        return pathlib.Path(f"{CACHE_DIR}/{self._safe_repo_url}")

    @computed_field(return_type=pathlib.Path, repr=False)
    @property
    def _cache_src_dir(self) -> pathlib.Path:
        return pathlib.Path(f"{self._cache_dir}/{CACHE_REPO_DIR_NAME}")

    @computed_field(return_type=pathlib.Path, repr=False)
    @property
    def _cache_repo_logs_json(self) -> pathlib.Path:
        return pathlib.Path(f"{self._cache_dir}/{CACHE_REPO_LOGS_NAME}")

    @computed_field(return_type=pathlib.Path, repr=False)
    @property
    def _cache_repo_overview_json(self) -> pathlib.Path:
        return pathlib.Path(f"{self._cache_dir}/{CACHE_OVERVIEW_FILE_NAME}")

    @computed_field(return_type=pathlib.Path, repr=False)
    @property
    def _cache_repo_tree_json(self) -> pathlib.Path:
        return pathlib.Path(f"{self._cache_dir}/{CACHE_REPO_TREE_FILE_NAME}")

    def clone_repo(self):
        repo_req = requests.get(
            f"{GITEA_API_URL}/repos/codecity/{self._internal_repo_name}",
            headers={"Authorization": f"token {GITEA_TOKEN}"},
        )

        if repo_req.status_code == 200:
            return

        requests.post(
            f"{GITEA_API_URL}/repos/migrate",
            json={
                "clone_addr": self.repo_url,
                "repo_name": self._internal_repo_name,
                "repo_owner": "codecity",
            },
            headers={"Authorization": f"token {GITEA_TOKEN}"},
        )

    def fetch_node(
        self,
        node_path: str,
    ):
        self.clone_repo()

        contents = requests.get(
            f"{GITEA_API_URL}/repos/codecity/{self._internal_repo_name}/contents/{node_path}",
            headers={"Authorization": f"token {GITEA_TOKEN}"},
        ).json()

        node_type = "tree" if isinstance(contents, list) else "blob"

        path = pathlib.Path(f"./{node_path}")
        name = path.name
        ancestors = list(path.parents)
        parent_path = ancestors[0] if len(ancestors) > 0 else None
        num_ancestors = len(ancestors)
        revision_stats = self.get_revision_stats(node_path)

        if node_type == "blob":
            file_contents = requests.get(
                f"{GITEA_API_URL}/repos/codecity/{self._internal_repo_name}/raw/{node_path}",
                headers={"Authorization": f"token {GITEA_TOKEN}"},
            ).text
            num_lines = len(file_contents.split("\n"))
            node = CodeCityBlobNode(
                node_type="blob",
                name=name,
                path=node_path,
                parent_path=parent_path,
                ancestor_paths=ancestors,
                depth=num_ancestors,
                revision_stats=revision_stats,
                suffix=path.suffix,
                suffixes=path.suffixes,
                num_lines=num_lines,
            )
            return node.model_dump_json(), []

        num_blobs = 0
        num_trees = 0
        nested_paths = []

        for item in contents:
            if item["type"] not in ["file", "dir"]:
                continue

            if item["type"] == "file":
                num_blobs += 1
            elif item["type"] == "dir":
                num_trees += 1

            nested_paths.append(item["path"])

        node = CodeCityTreeNode(
            node_type="tree",
            name=name,
            path=node_path,
            parent_path=parent_path,
            ancestor_paths=ancestors,
            depth=num_ancestors,
            revision_stats=revision_stats,
            num_child_blobs=num_blobs,
            num_child_trees=num_trees,
        )
        return node.model_dump_json(), nested_paths

    def get_node_commits(self, node_path: str) -> list[datetime]:
        commits_page_1_req = requests.get(
            f"{GITEA_API_URL}/repos/codecity/{self._internal_repo_name}/commits?path={node_path}",
        )

        total_pages = int(commits_page_1_req.headers["X-PageCount"])

        first_page_commits = commits_page_1_req.json()

        if total_pages == 1:
            last_page_commits = []
        else:
            last_page_commits = requests.get(
                f"{GITEA_API_URL}/repos/codecity/{self._internal_repo_name}/commits?path={node_path}&page={total_pages}",
            ).json()

        first_page_commit_datetimes = [
            datetime.fromisoformat(commit["created"]) for commit in first_page_commits
        ]

        last_page_commit_datetimes = [
            datetime.fromisoformat(commit["created"]) for commit in last_page_commits
        ]

        return first_page_commit_datetimes + last_page_commit_datetimes

    def get_revision_stats(self, path: str) -> CodeCityRevisionStats:
        now = datetime.now(timezone.utc)
        revision_stats = CodeCityRevisionStats(
            updated_on=None,
            created_on=None,
            median_updated_on=None,
            local_age=None,
            local_maintenance=None,
            local_median_maintenance=None,
            global_age=None,
            global_maintenance=None,
            global_median_maintenance=None,
        )

        root_commits = self.get_node_commits(".")
        repo_created_on = root_commits[-1] if len(root_commits) > 0 else None
        repo_updated_on = root_commits[0] if len(root_commits) > 0 else None

        node_commits = self.get_node_commits(path)
        last_commit_datetime = node_commits[0] if len(node_commits) > 0 else None
        first_commit_datetime = node_commits[-1] if len(node_commits) > 0 else None

        revision_stats.created_on = first_commit_datetime
        revision_stats.updated_on = last_commit_datetime
        revision_stats.median_updated_on = median_datetime(
            [last_commit_datetime, first_commit_datetime]  # type: ignore
        )

        if repo_created_on is None or repo_updated_on is None:
            return revision_stats

        if revision_stats.created_on is not None:
            revision_stats.local_age = calc_inverse_distance_ratio(
                revision_stats.created_on, repo_created_on, repo_updated_on
            )
            revision_stats.global_age = calc_inverse_distance_ratio(
                revision_stats.created_on, repo_created_on, now
            )

        if revision_stats.updated_on is not None:
            revision_stats.local_maintenance = calc_distance_ratio(
                revision_stats.updated_on, repo_created_on, repo_updated_on
            )
            revision_stats.global_maintenance = calc_distance_ratio(
                revision_stats.updated_on, repo_created_on, now
            )

        if revision_stats.median_updated_on is not None:
            revision_stats.local_median_maintenance = calc_distance_ratio(
                revision_stats.median_updated_on, repo_created_on, repo_updated_on
            )
            revision_stats.global_median_maintenance = calc_distance_ratio(
                revision_stats.median_updated_on, repo_created_on, now
            )

        return revision_stats
