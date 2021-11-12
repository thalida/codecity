# Python
import json
import pathlib
from pprint import pprint
from copy import deepcopy

import codecity.helpers
from codecity.api import GithubApi, GitPython

class CodeWorld:
    def __init__(
        self,
        owner,
        api_token,
        api_cache_ttl=codecity.helpers.DEFAULT_API_CACHE_TTL,
    ):
        self.owner = owner
        self.api = GithubApi(owner, api_token, cache_ttl=api_cache_ttl)
        self.cities = {}

    def get_or_create_city(self, repo_name):
        self.cities[repo_name] = CodeCity(self, repo_name)
        # if repo_name not in self.cities:
        #     self.cities[repo_name] = CodeCity(self, repo_name)

        return self.cities[repo_name]

    def get_api(self):
        return self.api

class CodeCity(CodeWorld):
    def __init__(
        self,
        world,
        repo_name,
    ):
        self.world = world
        self.repo_name = repo_name

        self.repo_info = {}
        self.tree = {}

        self.api = self.world.get_api()
        self.base_api_vars = { "repo_name": self.repo_name }
        self.fetch_repo_info()
        self.tree = self.fetch_repo_tree()

        cache_file = pathlib.Path(f"./codecity/cache/{self.world.owner}/{self.repo_name}/tree.json")
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with cache_file.open(mode="w") as f:
            json.dump(self.tree, f, indent=4, sort_keys=True)


    def fetch_repo_info(self):
        res = self.api.get("repo", variables=self.base_api_vars)
        self.repo_info = res

    def fetch_repo_tree(self, tree=None, parent_path="."):
        repo = GitPython.fetchRepo(f'{self.world.owner}/{self.repo_name}')
        tree = GitPython.getRepoTree(repo)
        return tree
        # default_tree_stats = {
        #     "num_ancestors": len(parent_path.split("/")) + 1 if parent_path != '.' else 1,

        #     "num_children": 0,
        #     "num_child_types": { "tree": 0, "blob": 0 },

        #     "num_descendants": 0,
        #     "num_descendant_types": { "tree": 0, "blob": 0 },
        # }

        # if tree is None:
        #     tree = {}
        #     tree[parent_path] = {
        #         "type": "tree",
        #         "parent_path": None,
        #         "path": parent_path,
        #         "children": [],
        #         "stats": deepcopy(default_tree_stats),
        #     }

        # try:
        #     src_tree = self.api.get("tree", variables={
        #         **self.base_api_vars,
        #         "path": parent_path,
        #     })
        # except Exception as e:
        #     print(f"Error fetching tree {parent_path}: {e}")
        #     return tree

        # for node in src_tree:
        #     node_path = node.get("path")
        #     node_type = node.get("type")

        #     tree[node_path] = {
        #         **node,
        #         "parent_path": parent_path,
        #         "children": [],
        #         "stats": deepcopy(default_tree_stats),
        #     }

        #     if node_type == "tree":
        #         child_tree = self.fetch_repo_tree(tree=deepcopy(tree), parent_path=node_path)
        #         tree |= child_tree
        #     else:
        #         tree[node_path]["blob"] = self.fetch_blob(node_path)

        #     tree[parent_path]["children"].append(node_path)
        #     tree[parent_path]["stats"]["num_children"] += 1
        #     tree[parent_path]["stats"]["num_child_types"][node_type] += 1
        #     tree[parent_path]["stats"]["num_descendants"] += 1 + tree[node_path]["stats"]["num_descendants"]
        #     tree[parent_path]["stats"]["num_descendant_types"][node_type] += 1
        #     tree[parent_path]["stats"]["num_descendant_types"]["tree"] += tree[node_path]["stats"]["num_descendant_types"]["tree"]
        #     tree[parent_path]["stats"]["num_descendant_types"]["blob"] += tree[node_path]["stats"]["num_descendant_types"]["blob"]

        # return tree

    def fetch_blob(self, path):
        try:
            raw_blob = self.api.get("blob", variables={
                **self.base_api_vars,
                "path": path,
            })

            blob = {
                **raw_blob,
                "stats": {
                    "num_lines": None,
                }
            }

            if blob["isBinary"]:
                return blob

            blob["stats"]["num_lines"] = len(blob.get("text", "").splitlines())
            return blob
        except Exception as e:
            print(f"Error fetching blob {path}: {e}")
            blob = { "errors": e.args[0] }
            return blob
