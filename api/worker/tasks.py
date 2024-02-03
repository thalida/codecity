import socketio
from celery import group, shared_task
from celery.signals import task_success
from rich import inspect, print  # noqa: F401, I001

from codecity.models import CodeCity


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
    name="codecity:get_repo_node_task",
)
def get_repo_node_task(self, repo_url: str, node_path: str, client_id: str):
    codecity = CodeCity(repo_url=repo_url)
    res = codecity.fetch_node(node_path)

    if not res:
        return {
            "repo_url": repo_url,
            "client_id": client_id,
            "node_path": node_path,
            "node": None,
            "nested_nodes": [],
        }

    node, nested_nodes = res

    if nested_nodes:
        job = group(
            [get_repo_node_task.s(repo_url, node, client_id) for node in nested_nodes]
        )
        job.apply_async()

    return {
        "repo_url": repo_url,
        "client_id": client_id,
        "node_path": node_path,
        "node": node,
        "nested_nodes": nested_nodes,
    }


@task_success.connect(sender=get_repo_node_task)
def task_success_handler(sender, result, **kwargs):
    print(
        f"Task {sender} finished successfully: {result['node_path']} emitting to {result['client_id']}"
    )
    external_sio = socketio.RedisManager("redis://", write_only=True)
    external_sio.emit("fetched_node", data=result, room=result["client_id"])
