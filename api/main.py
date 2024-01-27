from rich import inspect, print  # noqa: F401, I001

import uvicorn as uvicorn
from fastapi import FastAPI

from worker.utils import create_celery
from codecity import router


def create_app() -> FastAPI:
    current_app = FastAPI(
        title="Asynchronous tasks processing with Celery and RabbitMQ",
        description="Sample FastAPI Application to demonstrate Event "
        "driven architecture with Celery and RabbitMQ",
        version="1.0.0",
    )

    current_app.celery_app = create_celery()
    current_app.include_router(router.router)
    return current_app


app = create_app()
celery = app.celery_app


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
