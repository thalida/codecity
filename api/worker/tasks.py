from rich import inspect, print  # noqa: F401, I001

from celery import group, shared_task
from celery.signals import task_success
from codecity.models import CodeCity


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
    name="codecity:get_repo_node_task",
)
def get_repo_node_task(self, repo_url: str, node_path: str):
    codecity = CodeCity(repo_url=repo_url)
    node, nested_nodes = codecity.fetch_node(node_path)

    if nested_nodes:
        job = group([get_repo_node_task.s(repo_url, node) for node in nested_nodes])
        job.apply_async()

    return node


@task_success.connect
def task_success_handler(sender, result, **kwargs):
    inspect(sender)
    inspect(result)
    print(f"Task {sender} finished successfully: {result!r}")
