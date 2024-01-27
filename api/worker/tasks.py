from rich import inspect, print  # noqa: F401, I001

from celery import shared_task
from codecity.models import CodeCity


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
    name="codecity:get_repo_tree_task",
)
def get_repo_tree_task(self, repo_url: str):
    codecity = CodeCity(repo_url=repo_url)
    return codecity.fetch_repo_tree()

@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
    name="codecity:get_repo_node_task",
)
def get_repo_node_task(self, repo_url: str, node):
    codecity = CodeCity(repo_url=repo_url)
    return codecity.fetch_node(node)
