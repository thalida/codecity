from typing import Any

import socketio
import uvicorn as uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from rich import print

from codecity.models import CodeCity
from worker.tasks import get_repo_node_task
from worker.utils import create_celery, get_task_info


def create_app() -> FastAPI:
    origins = [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:8000",
    ]

    current_app = FastAPI(
        title="Asynchronous tasks processing with Celery and RabbitMQ",
        description="Sample FastAPI Application to demonstrate Event "
        "driven architecture with Celery and RabbitMQ",
        version="1.0.0",
    )

    current_app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
    )

    current_app.celery_app = create_celery()

    mgr = socketio.AsyncRedisManager("redis://")
    sio: Any = socketio.AsyncServer(
        async_mode="asgi",
        cors_allowed_origins=[],
        namespaces=["*"],
        client_manager=mgr,
    )

    socket_app = socketio.ASGIApp(sio, socketio_path="/")
    current_app.socket_app = socket_app
    current_app.sio = sio
    current_app.mount("/socket.io", socket_app)

    return current_app


app = create_app()
celery = app.celery_app
sio = app.sio


@app.get("/task/{task_id}")
async def get_task_status(task_id: str) -> dict:
    """
    Return the status of the submitted Task
    """
    return get_task_info(task_id)


@sio.on("connect")
async def connect(sid, env):
    pass


@sio.on("disconnect")
async def disconnect(sid):
    pass


@sio.on("fetch_repo")
async def fetch_repo(sid, data: dict):
    repo_url = data.get("repo_url")
    client_id = data.get("client_id")

    print(f"fetch_repo {repo_url} for {client_id}")

    await sio.enter_room(sid, client_id)

    if not repo_url:
        await sio.emit(
            "fetch_repo_error",
            {
                "repo_url": repo_url,
                "client_id": client_id,
                "error": "repo_url is required",
            },
            room=client_id,
        )
        return

    try:
        codecity = CodeCity(repo_url=repo_url)
        codecity.clone_repo()
    except Exception as e:
        print(e)
        await sio.emit(
            "fetch_repo_error",
            {
                "repo_url": repo_url,
                "client_id": client_id,
                "error": str(e),
            },
            room=client_id,
        )
        return

    task = get_repo_node_task.apply_async(args=[repo_url, ".", client_id])

    await sio.emit(
        "fetch_repo_started",
        {
            "repo_url": repo_url,
            "client_id": client_id,
            "task_id": task.id,
        },
        room=client_id,
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
