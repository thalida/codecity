import os
import pathlib
import json
import time

import git
import requests

DISABLE_CACHE = True
DEFAULT_API_CACHE_TTL = 60 * 60 # 1 hour
DEFAULT_INSIGHTS_CACHE_TTL = 30 * 60 # 30 minutes

if DISABLE_CACHE:
    DEFAULT_API_CACHE_TTL = 0
    DEFAULT_INSIGHTS_CACHE_TTL = 0

def get_stats(path_str):
    path = pathlib.Path(path_str)
    stats = path.stat()
    return {
        'size': stats.st_size,
        'modified_time': stats.st_mtime,
        'created_time': stats.st_ctime,
    }

def get_is_url_up(url):
    try:
        req = requests.get(url)
        return req.status_code == requests.codes.ok
    except Exception as e:
        return False

class GitProgress(git.remote.RemoteProgress):
    def update(self, op_code, cur_count, max_count=None, message=''):
        print(f'{op_code}, {cur_count}, {max_count}, {message}')


def get_repo(owner, repo_name):
    cache_file = pathlib.Path(f'./cache/api/{owner}__{repo_name}/info.json')
    cached_at = cache_file.stat().st_mtime if cache_file.exists() else None
    if cached_at is not None and time.time() < cached_at + DEFAULT_API_CACHE_TTL:
        with cache_file.open(mode="r") as f:
            response = json.load(f)

        return response

    repo_dir = pathlib.Path(f'./cache/{owner}__{repo_name}/repo')
    repo_url = f'https://github.com/{owner}/{repo_name}.git'

    if repo_dir.exists():
        repo = git.Repo.init(repo_dir)
        repo.remotes.origin.pull()
    else:
        repo = git.Repo.clone_from(
            repo_url,
            repo_dir,
            progress=GitProgress(),
            multi_options=['--single-branch']
        )

    repo_info = fetch_repo_info(owner, repo_name)
    tree = get_repo_tree(repo)
    response = {
        'repo': repo_info,
        'tree': tree,
    }

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    with cache_file.open(mode="w") as f:
        json.dump(response, f)

    return response

def fetch_repo_info(repo_owner, repo_name):
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
        json = {"query": query, "variables": {"owner": repo_owner, "repo_name": repo_name}}
        request = requests.post("https://api.github.com/graphql", json=json, headers=headers)
        response = request.json()

        if request.status_code == 200:
            return response.get('data', {}).get('repository')

        request.raise_for_status()
    except:
        raise

def get_repo_tree(repo):
    repoTree = repo.tree()
    dirTree = repoTree.traverse()
    processedTree = {}
    root_path = '.'
    processedTree[root_path] = {
        "type": "tree",
        "parent_path": None,
        "path": root_path,
        "child_paths": [],
        "suffix": None,
        "suffixes": None,
        "file_stats": get_stats(repo.working_tree_dir),
        "tree_stats": {
            "num_children": 0,
            "num_descendants": 0,
        }
    }

    for item in dirTree:
        full_path = pathlib.Path(item.abspath)
        parent_path = full_path.parent.relative_to(repo.working_tree_dir)
        parent_path_str = str(parent_path)
        node = {
            'type': item.type,
            'parent_path': parent_path_str,
            'path': item.path,
            'name': item.name,
            "child_paths": [],
            'suffix': full_path.suffix,
            'suffixes': full_path.suffixes,
            'file_stats': get_stats(full_path),
            "tree_stats": {
                "num_children": 0,
                "num_descendants": 0,
            }
        }

        if item.type == "blob":
            node['mime_type'] = item.mime_type
            try:
                node['content'] = full_path.read_text()
                node['file_stats']['num_lines'] = len(node['content'].splitlines())
                node['isBinary'] = False
            except UnicodeDecodeError:
                node['content'] = None
                node['isBinary'] = True
            except Exception as e:
                node['content'] = None
                node['content_error'] = str(e)

        parent_dirs = parent_path_str.split('/')

        if (parent_path_str != root_path):
            processedTree[root_path]['tree_stats']['num_descendants'] += 1

        for i in range(len(parent_dirs)):
            ancestor_path = '/'.join(parent_dirs[:i+1])

            if (i == len(parent_dirs) - 1):
                processedTree[ancestor_path]['tree_stats']['num_children'] += 1
                processedTree[ancestor_path]['child_paths'].append(item.path)

            processedTree[ancestor_path]['tree_stats']['num_descendants'] += 1

        processedTree[item.path] = node

    return processedTree
