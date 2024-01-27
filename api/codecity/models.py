from rich import inspect, print  # noqa: F401, I001

import base64
import json
import os
import pathlib
from datetime import datetime, timezone
from typing import Literal, Optional, Union, cast

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
    mime_type: str
    size: int
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

    async def get_repo(self):
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

    def fetch_repo_overview(self) -> CodeCityRepoOverview:
        now = datetime.now(timezone.utc)
        use_cache = False

        if self._cache_repo_overview_json.exists():
            with self._cache_repo_overview_json.open(mode="r") as f:
                cache = json.load(f)
                cached_at = datetime.fromisoformat(cache["cached_at"])
                use_cache = (now - cached_at).total_seconds() < CACHE_TTL
                if use_cache:
                    return CodeCityRepoOverview(**cache["repo_overview"])

        repo = self.get_repo()

        gh_url_parts = self.repo_url.split("github.com")
        is_github = len(gh_url_parts) > 1

        if not is_github:
            return CodeCityRepoOverview(
                url=self.repo_url,
                name=self.repo_url,
                description=repo.description,
            )

        gh_repo_path = gh_url_parts[1].replace(".git", "")
        gh_repo_path = gh_repo_path[1:]
        repo_owner, repo_name = gh_repo_path.split("/")
        query = """
            query ($owner:String!, $repo_name:String!) {
                repository(name: $repo_name, owner: $owner) {
                    name
                    description
                    createdAt
                    updatedAt
                }
            }
        """
        try:
            headers = {"Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}"}
            json_req = {
                "query": query,
                "variables": {"owner": repo_owner, "repo_name": repo_name},
            }
            request = requests.post(
                "https://api.github.com/graphql", json=json_req, headers=headers
            )
            gh_response = request.json()

            if request.status_code != 200:
                return CodeCityRepoOverview(url=self.repo_url)

            repo_res = gh_response.get("data", {}).get("repository", {})

            response = CodeCityRepoOverview(
                url=self.repo_url,
                name=repo_res.get("name"),
                description=repo_res.get("description"),
                created_at=repo_res.get("createdAt"),
                updated_at=repo_res.get("updatedAt"),
            )

            self._cache_repo_overview_json.parent.mkdir(parents=True, exist_ok=True)
            with self._cache_repo_overview_json.open(mode="w") as f:
                json.dump(
                    {
                        "cached_at": now.isoformat(),
                        "repo_overview": json.loads(response.model_dump_json()),
                    },
                    f,
                )

            return response

        except Exception:
            return CodeCityRepoOverview(url=self.repo_url)

    def list_repo(self):
        repo = self.get_repo()
        repo_tree = repo.tree()
        nodes = ["."] + list(repo_tree.traverse(branch_first=True))
        return nodes

    def fetch_node(
        self,
        item: any,
    ) -> CodeCityNode:
        now = datetime.now(timezone.utc)
        root_node_path = "."

        repo = self.get_repo()
        repo_tree = repo.tree()

        if item == root_node_path:
            node = CodeCityTreeNode(
                node_type="tree",
                depth=0,
                path=root_node_path,
                name=root_node_path,
                parent_path=None,
                ancestor_paths=None,
                revision_stats=self.get_revision_stats(
                    repo,
                    cast(git.PathLike, repo.working_tree_dir),
                    now=now,
                    is_root=True,
                ),
                num_child_blobs=len(repo_tree.blobs),
                num_child_trees=len(repo_tree.trees),
                is_root=True,
            )
        else:
            root_node_revision_stats = self.get_revision_stats(
                repo, cast(git.PathLike, repo.working_tree_dir), now=now, is_root=True
            )
            full_path = pathlib.Path(item.abspath)
            relative_path = full_path.relative_to(self._cache_src_dir)
            node_path = f"{item.path}"
            ancestors = list(relative_path.parents)
            parent_path = ancestors[0] if len(ancestors) > 0 else None
            num_ancestors = len(ancestors)
            revision_stats = self.get_revision_stats(
                repo,
                item.path,
                now=now,
                root_node_revision_stats=root_node_revision_stats,
            )

            if item.type == "blob":
                num_lines = None
                try:
                    with full_path.open(mode="r") as f:
                        num_lines = len(f.readlines())
                except Exception:
                    pass

                node = CodeCityBlobNode(
                    node_type="blob",
                    name=item.name,
                    path=node_path,
                    parent_path=parent_path,
                    ancestor_paths=ancestors,
                    depth=num_ancestors,
                    revision_stats=revision_stats,
                    mime_type=item.mime_type,
                    size=item.size,
                    suffix=full_path.suffix,
                    suffixes=full_path.suffixes,
                    num_lines=num_lines,
                )
            else:
                node = CodeCityTreeNode(
                    node_type="tree",
                    name=item.name,
                    path=node_path,
                    parent_path=parent_path,
                    ancestor_paths=ancestors,
                    depth=num_ancestors,
                    revision_stats=revision_stats,
                    num_child_blobs=len(item.blobs),
                    num_child_trees=len(item.trees),
                )

        return node.model_dump_json()

    def fetch_repo_tree(
        self,
    ) -> list[CodeCityNode]:
        now = datetime.now(timezone.utc)
        use_cache = False

        if self._cache_repo_tree_json.exists():
            with self._cache_repo_tree_json.open(mode="r") as f:
                cache = json.load(f)
                cached_at = datetime.fromisoformat(cache["cached_at"])
                use_cache = (now - cached_at).total_seconds() < CACHE_TTL
                if use_cache:
                    return cache["repo_tree"]

        nodes = []

        repo = self.get_repo()
        repo_tree = repo.tree()

        root_node_path = "."

        root_node = CodeCityTreeNode(
            node_type="tree",
            depth=0,
            path=root_node_path,
            name=root_node_path,
            parent_path=None,
            ancestor_paths=None,
            revision_stats=self.get_revision_stats(
                repo, cast(git.PathLike, repo.working_tree_dir), now=now, is_root=True
            ),
            num_child_blobs=len(repo_tree.blobs),
            num_child_trees=len(repo_tree.trees),
            is_root=True,
        )

        nodes.append(root_node.model_dump_json())

        for item in repo_tree.traverse(branch_first=True):
            if item.type not in ["blob", "tree"]:
                continue

            full_path = pathlib.Path(item.abspath)
            relative_path = full_path.relative_to(self._cache_src_dir)
            node_path = f"{item.path}"
            ancestors = list(relative_path.parents)
            parent_path = ancestors[0] if len(ancestors) > 0 else None
            num_ancestors = len(ancestors)
            revision_stats = self.get_revision_stats(
                repo,
                item.path,
                now=now,
                root_node_revision_stats=root_node.revision_stats,
            )

            if item.type == "blob":
                num_lines = None
                try:
                    with full_path.open(mode="r") as f:
                        num_lines = len(f.readlines())
                except Exception:
                    pass

                node = CodeCityBlobNode(
                    node_type="blob",
                    name=item.name,
                    path=node_path,
                    parent_path=parent_path,
                    ancestor_paths=ancestors,
                    depth=num_ancestors,
                    revision_stats=revision_stats,
                    mime_type=item.mime_type,
                    size=item.size,
                    suffix=full_path.suffix,
                    suffixes=full_path.suffixes,
                    num_lines=num_lines,
                )
            else:
                node = CodeCityTreeNode(
                    node_type="tree",
                    name=item.name,
                    path=node_path,
                    parent_path=parent_path,
                    ancestor_paths=ancestors,
                    depth=num_ancestors,
                    revision_stats=revision_stats,
                    num_child_blobs=len(item.blobs),
                    num_child_trees=len(item.trees),
                )

            nodes.append(json.loads(node.model_dump_json()))

        self._cache_repo_tree_json.parent.mkdir(parents=True, exist_ok=True)
        with self._cache_repo_tree_json.open(mode="w") as f:
            json.dump(
                {
                    "cached_at": now.isoformat(),
                    "repo_tree": json.loads(json.dumps(nodes)),
                },
                f,
            )

        return nodes

    def get_revision_stats(
        self,
        repo: git.Repo,
        path: git.PathLike,
        now: datetime = datetime.now(timezone.utc),
        is_root: bool = False,
        root_node_revision_stats: CodeCityRevisionStats | None = None,
    ) -> CodeCityRevisionStats:
        # commits_generator = repo.iter_commits(paths=path)
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

        commits = list(repo.iter_commits(paths=path))

        last_commit_datetime = (
            commits[0].committed_datetime.replace(tzinfo=timezone.utc)
            if len(commits) > 0
            else None
        )
        first_commit_datetime = (
            commits[-1].committed_datetime.replace(tzinfo=timezone.utc)
            if len(commits) > 0
            else None
        )

        revision_stats.created_on = first_commit_datetime
        revision_stats.updated_on = last_commit_datetime
        revision_stats.median_updated_on = median_datetime(
            [last_commit_datetime, first_commit_datetime]  # type: ignore
        )

        if is_root:
            root_node_revision_stats = revision_stats

        if root_node_revision_stats is None:
            return revision_stats

        repo_created_on = root_node_revision_stats.created_on
        repo_updated_on = root_node_revision_stats.updated_on

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
