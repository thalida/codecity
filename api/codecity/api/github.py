# Python
import os
import re
os.environ['TZ'] = 'UTC'
import logging
from copy import deepcopy
import time
import json
import pathlib

# External
import requests

# App
import codecity.helpers

class GithubApi:
    def __init__(self, owner=None, token=None, cache_ttl=codecity.helpers.DEFAULT_API_CACHE_TTL):
        self.owner = owner
        self.headers = {"Authorization": f"bearer {token}"}
        self.cache_ttl = cache_ttl
        self.queries = {}

        self.add_query(
            query_name="repo",
            response_selector="data.repository",
            query="""
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
        )

        self.add_query(
            query_name="tree",
            response_selector="data.repository.defaultBranchRef.target.file.object.entries",
            cache_filename="{query_name}/{path}.json",
            query="""
                query ($owner:String!, $repo_name:String!, $path:String!) {
                    rateLimit {
                        cost
                        limit
                        remaining
                        resetAt
                    }
                    repository(name: $repo_name, owner: $owner) {
                        defaultBranchRef {
                            target {
                                ... on Commit {
                                    file(path: $path) {
                                        path
                                        object {
                                            ... on Tree {
                                                id
                                                entries {
                                                    name
                                                    path
                                                    extension
                                                    mode
                                                    isGenerated
                                                    type
                                                    oid
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            """
        )

        self.add_query(
            query_name="blob",
            response_selector="data.repository.defaultBranchRef.target.file.object",
            cache_filename="{query_name}/{path}.json",
            query="""
                query ($owner:String!, $repo_name:String!, $path:String!) {
                    rateLimit {
                        cost
                        limit
                        remaining
                        resetAt
                    }
                    repository(name: $repo_name, owner: $owner) {
                        defaultBranchRef {
                            target {
                                ... on Commit {
                                    file(path: $path) {
                                        path
                                        object {
                                            ... on Blob {
                                                id
                                                text
                                                isBinary
                                                byteSize
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            """
        )


    def add_query(
        self,
        query_name,
        query,
        response_selector,
        cache_dir="./codecity/cache/{owner}/{repo_name}/",
        cache_filename="{query_name}.json",
        cache_ttl=None
    ):
        new_query = {
            "query_name": query_name,
            "query": query,
            "response_selector": response_selector,
            "cache_filepath": f"{cache_dir}{cache_filename}",
            "cache_ttl":  cache_ttl if cache_ttl is not None else self.cache_ttl,
        }
        self.queries[query_name] = new_query
        return self.queries[query_name]

    def run_query(self, query, variables):
        try:
            json = {"query": query, "variables": variables}
            request = requests.post("https://api.github.com/graphql", json=json, headers=self.headers)
            response = request.json()

            if request.status_code == 200:
                return response

            request.raise_for_status()
        except:
            raise

        return

    def get(self, query_name, variables={}):
        query_data = self.queries[query_name]

        try:
            variables = {
                "owner": self.owner,
                **variables,
            }

            from_cache = False
            format_variables = deepcopy(variables)
            if format_variables.get("path"):
                format_variables["path"] = format_variables["path"].replace("/", "--")

            cache_filepath = query_data["cache_filepath"].format(query_name=query_name, **format_variables)
            cache_file = pathlib.Path(cache_filepath)
            cached_at = cache_file.stat().st_mtime if cache_file.exists() else None
            if cached_at is not None and time.time() < cached_at + query_data["cache_ttl"]:
                with cache_file.open(mode="r") as f:
                    from_cache = True
                    response = json.load(f)
            else:
                response = self.run_query(query_data["query"], variables)

            if not from_cache:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                with cache_file.open(mode="w") as f:
                    json.dump(response, f)


            raw_errors = codecity.helpers.deep_get(response, "errors")
            if raw_errors:
                errors = [{"message": e["message"], "type": e["type"]} for e in raw_errors]
                raise Exception(errors)

            response_data = codecity.helpers.deep_get(response, query_data["response_selector"])
            return response_data
        except Exception as e:
            raise
