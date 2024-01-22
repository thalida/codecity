import base64
import json
import os
import pathlib
import time
from typing import cast

import git
import requests
from rich import print  # noqa: F401

from .models import (
    CodeCityBlobNode,
    CodeCityRepoOverview,
    CodeCityResponse,
    CodeCityRevisionStats,
    CodeCityRootTree,
    CodeCityTreeNode,
)
from .settings import (
    CACHE_FILENAME,
    CACHE_PARENT_DIR,
    CACHE_REPO_DIR,
    CACHE_TTL,
)

os.environ["TZ"] = "UTC"


class CodeCity:
    def __init__(self, repo_url):
        self.repo_url = repo_url

    @property
    def repo_url(self):
        return self._repo_url

    @property
    def safe_repo_url(self):
        return self._safe_repo_url

    @property
    def cache_dir(self):
        return pathlib.Path(f"{CACHE_PARENT_DIR}/{self.safe_repo_url}")

    @property
    def cache_file(self):
        return pathlib.Path(f"{self.cache_dir}/{CACHE_FILENAME}")

    @property
    def cache_src_dir(self):
        return pathlib.Path(f"{self.cache_dir}/{CACHE_REPO_DIR}")

    @repo_url.setter
    def repo_url(self, repo_url: str):
        if not self.validate_repo_url(repo_url):
            raise Exception(f"Invalid repo url: {repo_url}")

        self._repo_url = repo_url
        self._safe_repo_url = base64.b64encode(repo_url.encode("utf-8")).decode("utf-8")

    @staticmethod
    def validate_repo_url(repo_url: str):
        git_cmd = git.cmd.Git()  # type: ignore
        with git_cmd.custom_environment(GIT_TERMINAL_PROMPT="0"):
            try:
                git_cmd.ls_remote(repo_url)
                return True
            except git.exc.GitCommandError:  # type: ignore
                return False

    def fetch(self) -> CodeCityResponse:
        cached_at = (
            self.cache_file.stat().st_mtime if self.cache_file.exists() else None
        )
        if cached_at is not None and time.time() < cached_at + CACHE_TTL:
            with self.cache_file.open(mode="r") as f:
                response = json.load(f)
            return CodeCityResponse.model_validate(response)

        if self.cache_src_dir.exists():
            repo = git.Repo.init(self.cache_src_dir)
            repo.git.reset("--hard")
            repo.git.clean("-fdx")
            repo.remotes.origin.pull()
        else:
            repo = git.Repo.clone_from(
                self.repo_url,
                self.cache_src_dir,
                multi_options=["--single-branch"],
            )

        repo_overview = self.get_repo_overview()
        tree = self.get_tree(repo)

        response = CodeCityResponse(repo=repo_overview, tree=tree)

        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        with self.cache_file.open(mode="w") as f:
            json.dump(response.model_dump_json(), f)

        return response

    def get_repo_overview(self) -> CodeCityRepoOverview:
        repo_info = CodeCityRepoOverview(url=self.repo_url)

        gh_url_parts = self.repo_url.split("github.com")

        if len(gh_url_parts) <= 1:
            return repo_info

        gh_repo_path = gh_url_parts[1].replace(".git", "")
        gh_repo_path = gh_repo_path[1:]
        owner, repo_name = gh_repo_path.split("/")
        repo_info = self.fetch_gh_repo_overview(owner, repo_name)

        return repo_info

    def fetch_gh_repo_overview(self, repo_owner: str, repo_name: str):
        query = """
            query ($owner:String!, $repo_name:String!) {
                rateLimit {
                    cost
                    limit
                    remaining
                    resetAt
                }
                repository(name: $repo_name, owner: $owner) {
                    url
                    stargazerCount
                    description
                    descriptionHTML
                    createdAt
                    homepageUrl
                    name
                    id
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
                id=repo_res.get("id"),
                name=repo_res.get("name"),
                description=repo_res.get("description"),
                description_html=repo_res.get("descriptionHTML"),
                homepage_url=repo_res.get("homepageUrl"),
                stargazer_count=int(repo_res.get("stargazerCount")),
                created_at=repo_res.get("createdAt"),
                updated_at=repo_res.get("updatedAt"),
            )

        except Exception as e:
            raise Exception(f"Error fetching repo info: {e}")

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

    def get_tree(self, repo: git.Repo) -> CodeCityRootTree:
        root_path = "."
        repo_tree = CodeCityRootTree(root_path=root_path, nodes={})
        repo_tree.nodes[root_path] = CodeCityTreeNode(
            node_type="tree",
            depth=0,
            parent_path=None,
            path=root_path,
            name=root_path,
            revision_stats=self.get_revision_stats(repo, repo.working_tree_dir),
            child_paths=[],
            num_children=0,
            num_child_blobs=0,
            num_child_trees=0,
            num_descendants=0,
            num_descendant_blobs=0,
            num_descendant_trees=0,
        )

        git_tree = repo.tree()
        for item in git_tree.traverse():
            full_path = pathlib.Path(item.abspath)
            node_path = f"{root_path}/{item.path}"
            parent_path = node_path.rsplit("/", 1)[0]
            ancestors = parent_path.split("/")
            num_ancestors = len(ancestors)

            if item.type not in ["blob", "tree"]:
                continue

            if item.type == "blob":
                node = CodeCityBlobNode(
                    node_type="blob",
                    depth=num_ancestors,
                    path=node_path,
                    parent_path=parent_path,
                    name=item.name,
                    mime_type=item.mime_type,
                    size=item.size,
                    suffix=full_path.suffix,
                    suffixes=full_path.suffixes,
                    num_lines=None,
                    revision_stats=self.get_revision_stats(repo, item.path),
                )

                try:
                    with full_path.open(mode="r") as f:
                        node.num_lines = len(f.readlines())
                except Exception:
                    pass
            else:
                node = CodeCityTreeNode(
                    node_type="tree",
                    depth=num_ancestors,
                    parent_path=parent_path,
                    path=node_path,
                    name=item.name,
                    revision_stats=self.get_revision_stats(repo, item.path),
                    child_paths=[],
                    num_children=0,
                    num_child_blobs=0,
                    num_child_trees=0,
                    num_descendants=0,
                    num_descendant_blobs=0,
                    num_descendant_trees=0,
                )

            repo_tree.nodes[node_path] = node

            for i in range(num_ancestors):
                ancestor_path = "/".join(ancestors[: i + 1])

                if (
                    ancestor_path not in repo_tree.nodes
                    or repo_tree.nodes[ancestor_path].node_type != "tree"
                ):
                    continue

                ancestor_node = cast(CodeCityTreeNode, repo_tree.nodes[ancestor_path])
                ancestor_node.num_descendants += 1

                if node.node_type == "blob":
                    ancestor_node.num_descendant_blobs += 1
                elif node.node_type == "tree":
                    ancestor_node.num_descendant_trees += 1

                if ancestor_path != parent_path:
                    continue

                ancestor_node.num_children += 1
                ancestor_node.child_paths.append(node_path)

                if node.node_type == "blob":
                    ancestor_node.num_child_blobs += 1
                elif node.node_type == "tree":
                    ancestor_node.num_child_trees += 1

        return repo_tree
