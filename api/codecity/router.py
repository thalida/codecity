from rich import inspect, print  # noqa: F401, I001

from fastapi import APIRouter
from starlette.responses import JSONResponse

from worker.utils import get_task_info
from worker.tasks import get_repo_node_task

router = APIRouter(
    prefix="/repos",
    tags=["Repo"],
    responses={404: {"description": "Not found"}},
)


@router.get("/task/{task_id}")
async def get_task_status(task_id: str) -> dict:
    """
    Return the status of the submitted Task
    """
    return get_task_info(task_id)


@router.post("/tree")
async def get_repo_tree(repo_url: str):
    task = get_repo_node_task.apply_async(args=[repo_url, "."])
    return JSONResponse({"task_id": task.id})
