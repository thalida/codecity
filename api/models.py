import base64
import os
import pathlib
from datetime import datetime
from typing import Generator, Literal, Optional, Union

import git
import requests
from pydantic import BaseModel, Field, computed_field, field_validator
from rich import inspect, print  # noqa: F401
from typing_extensions import Annotated

os.environ["TZ"] = "UTC"

CACHE_DIR = pathlib.Path(__file__).parent / "cache"
CACHE_REPO_DIR_NAME = "src"


class CodeCityRepoOverview(BaseModel):
    url: str
    name: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CodeCityRevisionStats(BaseModel):
    num_commits: int = Field(ge=0)
    num_contributors: int = Field(ge=0)
    last_commit_time: datetime | None
    first_commit_time: datetime | None


class BaseCodeCityNode(BaseModel):
    path: str
    name: str
    parent_path: pathlib.Path | None
    ancestor_paths: list[pathlib.Path] | None
    depth: int = Field(ge=0)
    revision_stats: CodeCityRevisionStats | None


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
    def _safe_repo_url(self):
        return base64.b64encode(self.repo_url.encode("utf-8")).decode("utf-8")

    @computed_field(return_type=pathlib.Path, repr=False)
    @property
    def _cache_src_dir(self) -> pathlib.Path:
        return pathlib.Path(f"{CACHE_DIR}/{self._safe_repo_url}/{CACHE_REPO_DIR_NAME}")

    def get_repo(self) -> git.Repo:
        if self._cache_src_dir.exists():
            repo = git.Repo.init(self._cache_src_dir)
            repo.git.reset("--hard")
            repo.git.clean("-fdx")
            repo.remotes.origin.pull()
        else:
            repo = git.Repo.clone_from(
                self.repo_url,
                self._cache_src_dir,
                multi_options=["--single-branch"],
            )

        return repo

    def fetch_repo_overview(self) -> CodeCityRepoOverview:
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
            json = {
                "query": query,
                "variables": {"owner": repo_owner, "repo_name": repo_name},
            }
            request = requests.post(
                "https://api.github.com/graphql", json=json, headers=headers
            )
            gh_response = request.json()

            if request.status_code != 200:
                return CodeCityRepoOverview(url=self.repo_url)

            repo_res = gh_response.get("data", {}).get("repository", {})

            return CodeCityRepoOverview(
                url=self.repo_url,
                name=repo_res.get("name"),
                description=repo_res.get("description"),
                created_at=repo_res.get("createdAt"),
                updated_at=repo_res.get("updatedAt"),
            )

        except Exception:
            return CodeCityRepoOverview(url=self.repo_url)

    def generate_tree(
        self,
    ) -> Generator[CodeCityNode, None, None]:
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
            revision_stats=self.get_revision_stats(repo, repo.working_tree_dir),
            num_child_blobs=len(repo_tree.blobs),
            num_child_trees=len(repo_tree.trees),
            is_root=True,
        )

        yield root_node

        for item in repo_tree.traverse(branch_first=True):
            if item.type not in ["blob", "tree"]:
                continue

            full_path = pathlib.Path(item.abspath)
            relative_path = full_path.relative_to(self._cache_src_dir)
            node_path = f"{item.path}"
            ancestors = list(relative_path.parents)
            parent_path = ancestors[0] if len(ancestors) > 0 else None
            num_ancestors = len(ancestors)

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
                    revision_stats=self.get_revision_stats(repo, item.path),
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
                    revision_stats=self.get_revision_stats(repo, item.path),
                    num_child_blobs=len(item.blobs),
                    num_child_trees=len(item.trees),
                )

            yield node

    def get_revision_stats(
        self, repo: git.Repo, path: git.PathLike | str | None
    ) -> CodeCityRevisionStats | None:
        if path is None:
            return None

        commits_generator = repo.iter_commits(paths=path, all=True)
        revision_stats = CodeCityRevisionStats(
            num_commits=0,
            num_contributors=0,
            last_commit_time=None,
            first_commit_time=None,
        )
        found_contributors = set()

        for commit in commits_generator:
            revision_stats.num_commits += 1
            revision_stats.first_commit_time = commit.committed_datetime

            if revision_stats.last_commit_time is None:
                revision_stats.last_commit_time = commit.committed_datetime

            found_contributors.add(commit.author.email)
            revision_stats.num_contributors = len(found_contributors)

        return revision_stats
