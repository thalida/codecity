import base64
import os
import pathlib
import json
import time

import git
import requests

# test_repo_dir = pathlib.Path(f"./cache/test_repo_dir")
# empty_repo = git.Repo.init(test_repo_dir)
# origin = empty_repo.create_remote("origin", "https://github.com/faketroisjs/trois.git")
# print(origin.exists())

DISABLE_CACHE = True
DEFAULT_API_CACHE_TTL = 60 * 60  # 1 hour
DEFAULT_INSIGHTS_CACHE_TTL = 30 * 60  # 30 minutes

if DISABLE_CACHE:
    DEFAULT_API_CACHE_TTL = 0
    DEFAULT_INSIGHTS_CACHE_TTL = 0


def is_valid_repo_url(repo_url):
    git_cmd = git.cmd.Git()
    with git_cmd.custom_environment(GIT_TERMINAL_PROMPT="0"):
        try:
            git_cmd.ls_remote(repo_url)
            return True
        except:
            return False


# "https://github.com/troisjs/trois.git"


def get_stats(path_str):
    path = pathlib.Path(path_str)
    stats = path.stat()
    return {
        "size": stats.st_size,
        "modified_time": stats.st_mtime,
        "created_time": stats.st_ctime,
    }


def get_is_url_up(url):
    try:
        req = requests.get(url)
        return req.status_code == requests.codes.ok
    except Exception as e:
        return False


class GitProgress(git.remote.RemoteProgress):
    def update(self, op_code, cur_count, max_count=None, message=""):
        print(f"{op_code}, {cur_count}, {max_count}, {message}")


def get_repo(repo_url):
    if not is_valid_repo_url(repo_url):
        raise Exception(f"Invalid repo url: {repo_url}")

    safe_repo_url = base64.b64encode(repo_url.encode("utf-8")).decode("utf-8")
    cache_dir = f"/tmp/codecity/cache/{safe_repo_url}"

    cache_file = pathlib.Path(f"{cache_dir}/repo_data.json")
    cached_at = cache_file.stat().st_mtime if cache_file.exists() else None
    if cached_at is not None and time.time() < cached_at + DEFAULT_API_CACHE_TTL:
        with cache_file.open(mode="r") as f:
            response = json.load(f)
        return response

    repo_dir = pathlib.Path(f"{cache_dir}/repo")
    if repo_dir.exists():
        repo = git.Repo.init(repo_dir)
        repo.remotes.origin.pull()
    else:
        repo = git.Repo.clone_from(
            repo_url,
            repo_dir,
            progress=GitProgress(),
            multi_options=["--single-branch", "--depth 1"],
        )

    gh_url_parts = repo_url.split("github.com")
    if len(gh_url_parts) > 1:
        gh_repo_path = gh_url_parts[1].replace(".git", "")
        gh_repo_path = gh_repo_path[1:]
        owner, repo_name = gh_repo_path.split("/")
        repo_info = fetch_gh_repo_info(owner, repo_name)
    else:
        repo_info = {
            "url": repo_url,
        }

    tree = get_repo_tree(repo)
    response = {
        "repo": repo_info,
        "tree": tree,
    }

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    with cache_file.open(mode="w") as f:
        json.dump(response, f)

    return response


def fetch_gh_repo_info(repo_owner, repo_name):
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
        headers = {"Authorization": f"bearer {os.getenv('GITHUB_TOKEN')}"}
        json = {
            "query": query,
            "variables": {"owner": repo_owner, "repo_name": repo_name},
        }
        request = requests.post(
            "https://api.github.com/graphql", json=json, headers=headers
        )
        response = request.json()

        if request.status_code == 200:
            return response.get("data", {}).get("repository")

        request.raise_for_status()
    except:
        raise


def get_repo_tree(repo):
    repoTree = repo.tree()
    dirTree = repoTree.traverse()
    processedTree = {}
    root_path = "."
    processedTree[root_path] = {
        "type": "tree",
        "depth": 0,
        "parent_path": None,
        "path": root_path,
        "child_paths": [],
        "suffix": None,
        "suffixes": None,
        "file_stats": get_stats(repo.working_tree_dir),
        "tree_stats": {
            "num_children": 0,
            "num_descendants": 0,
            "num_child_blobs": 0,
            "num_child_trees": 0,
        },
    }

    for item in dirTree:
        full_path = pathlib.Path(item.abspath)
        parent_path = full_path.parent.relative_to(repo.working_tree_dir)
        parent_path_str = str(parent_path)
        node = {
            "type": item.type,
            "depth": 0,
            "parent_path": parent_path_str,
            "path": item.path,
            "name": item.name,
            "child_paths": [],
            "suffix": full_path.suffix,
            "suffixes": full_path.suffixes,
            "file_stats": get_stats(full_path),
            "tree_stats": {
                "num_children": 0,
                "num_descendants": 0,
                "num_child_blobs": 0,
                "num_child_trees": 0,
            },
        }

        if item.type == "blob":
            node["mime_type"] = item.mime_type
            try:
                node["content"] = full_path.read_text()
                node["file_stats"]["num_lines"] = len(node["content"].splitlines())
                node["isBinary"] = False
            except UnicodeDecodeError:
                node["content"] = None
                node["isBinary"] = True
            except Exception as e:
                node["content"] = None
                node["content_error"] = str(e)

        parent_dirs = parent_path_str.split("/")

        if parent_path_str != root_path:
            node["depth"] = len(parent_dirs) + 1
            processedTree[root_path]["tree_stats"]["num_descendants"] += 1
        else:
            node["depth"] = len(parent_dirs)

        for i in range(len(parent_dirs)):
            ancestor_path = "/".join(parent_dirs[: i + 1])

            if i == len(parent_dirs) - 1:
                processedTree[ancestor_path]["tree_stats"]["num_children"] += 1
                processedTree[ancestor_path]["child_paths"].append(item.path)

                if item.type == "blob":
                    processedTree[ancestor_path]["tree_stats"]["num_child_blobs"] += 1
                elif item.type == "tree":
                    processedTree[ancestor_path]["tree_stats"]["num_child_trees"] += 1

            processedTree[ancestor_path]["tree_stats"]["num_descendants"] += 1

        processedTree[item.path] = node

    return processedTree
