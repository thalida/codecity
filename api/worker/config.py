from rich import inspect, print  # noqa: F401, I001

import os
from functools import lru_cache

from kombu import Queue


def route_task(name, args, kwargs, options, task=None, **kw):
    if ":" in name:
        queue, _ = name.split(":")
        return {"queue": queue}
    return {"queue": "celery"}


class BaseConfig:
    CELERY_BROKER_URL: str = os.environ.get(
        "CELERY_BROKER_URL", "amqp://guest:guest@0.0.0.0:5672//"
    )
    result_backend: str = os.environ.get(
        "CELERY_RESULT_BACKEND", "redis://0.0.0.0:6379/0"
    )

    CELERY_TASK_QUEUES: list = [
        # default queue
        Queue("celery"),
        # custom queue
        Queue("codecity"),
    ]

    CELERY_TASK_ROUTES = (route_task,)


class DevelopmentConfig(BaseConfig):
    pass


@lru_cache()
def get_settings():
    config_cls_dict = {
        "development": DevelopmentConfig,
    }
    config_name = os.environ.get("CELERY_CONFIG", "development")
    config_cls = config_cls_dict[config_name]
    return config_cls()


settings = get_settings()
