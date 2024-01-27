from rich import inspect, print  # noqa: F401, I001

from fastapi import APIRouter
from starlette.responses import JSONResponse
from celery import group

from codecity.models import CodeCity, CodeCityRepoOverview
from worker.utils import get_task_info
from worker.tasks import get_repo_node_task, get_repo_tree_task

router = APIRouter(
    prefix="/repos",
    tags=["Repo"],
    responses={404: {"description": "Not found"}},
)


@router.post("/overview")
async def get_repo_overview(repo_url: str):
    codecity = CodeCity(repo_url=repo_url)
    return await codecity.get_repo()
    # return codecity.fetch_repo_overview()


@router.get("/task/{task_id}")
async def get_task_status(task_id: str) -> dict:
    """
    Return the status of the submitted Task
    """
    return get_task_info(task_id)


@router.post("/tree")
async def get_repo_tree(repo_url: str):
    print("queue", repo_url)
    task = get_repo_tree_task.apply_async(args=[repo_url])
    return JSONResponse({"task_id": task.id})


@router.post("/parallel")
async def get_repo_tree_parallel(repo_url: str):
    codecity = CodeCity(repo_url=repo_url)
    nodes = codecity.list_repo()
    job = group([get_repo_node_task.s(repo_url, node) for node in nodes])
    job.apply_async()


    # data: dict = {}
    # tasks = []
    # for cnt in country.countries:
    #     tasks.append(get_university_task.s(cnt))
    # # create a group with all the tasks
    # job = group(tasks)
    # result = job.apply_async()
    # ret_values = result.get(disable_sync_subtasks=False)
    # for result in ret_values:
    #     data.update(result)
    # return data
