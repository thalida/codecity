import os
import pathlib
import json
import git

def get_stats(path_str):
    path = pathlib.Path(path_str)
    stats = path.stat()
    return {
        'size': stats.st_size,
        'modified_time': stats.st_mtime,
        'created_time': stats.st_ctime,
    }


class Progress(git.remote.RemoteProgress):
    def update(self, op_code, cur_count, max_count=None, message=''):
        print(f'{op_code}, {cur_count}, {max_count}, {message}')

class GitPython:
    def fetchRepo(repo):
        repo_dir = pathlib.Path(f'./codecity/cache/repos/{repo}')
        repo_url = f'https://github.com/{repo}.git'
        if repo_dir.exists():
            repo = git.Repo.init(repo_dir)
            repo.remotes.origin.pull()
        else:
            repo = git.Repo.clone_from(
                repo_url,
                repo_dir,
                progress=Progress(),
                multi_options=['--single-branch']
            )
        return repo

    def getRepoTree(repo):
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
