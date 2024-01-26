import os
import time
from typing import Any

import socketio
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse
from fastapi.routing import APIRoute
from rich import inspect, print  # noqa: I001, F401

from models import (
    CodeCity,
)

os.environ["TZ"] = "UTC"

load_dotenv()


def custom_generate_unique_id(route: APIRoute):
    if route.tags is None or len(route.tags) == 0:
        return route.name

    return f"{route.tags[0]}-{route.name}"


DEBUG = os.environ.get("DEBUG", False)
DEBUG = True if DEBUG == "True" or DEBUG == 1 else False

sio: Any = socketio.AsyncServer(
    async_mode="asgi", cors_allowed_origins=[], namespaces=["*"]
)
socket_app = socketio.ASGIApp(sio, socketio_path="/")
app = FastAPI(
    debug=DEBUG,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
)

origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
)

app.mount("/socket.io", socket_app)


@sio.on("connect")
async def connect(sid, env):
    print("on connect")


@sio.on("fetch_repo")
async def fetch_repo(sid, repo_url):
    print(f"fetch_repo {repo_url}")

    codecity = CodeCity(repo_url=repo_url)
    repo_overview = codecity.fetch_repo_overview()

    await sio.emit(
        "repo_overview",
        repo_overview.model_dump_json(),
        room=sid,
    )

    start_time = time.time()
    print(f"start_time {start_time}")
    nodes = list(codecity.iter_tree())
    mid_time = time.time()
    print(f"mid_time {mid_time}")
    nodes = [node.model_dump_json() for node in nodes]
    end_time = time.time()
    print(f"end_time {end_time}")
    print(f"duration: {end_time - start_time}")
    print(f"num nodes {len(nodes)}")

    # for node in codecity.iter_tree():
    #     await sio.emit(
    #         "repo_node",
    #         node.model_dump_json(),
    #         room=sid,
    #     )

    await sio.emit(
        "fetch_complete",
        nodes,
        room=sid,
    )


@sio.on("broadcast")
async def broadcast(sid, msg):
    print(f"broadcast {msg}")
    await sio.emit("event_name", msg)  # or send to everyone


@sio.on("disconnect")
async def disconnect(sid):
    print("on disconnect")


@app.get("/docs", include_in_schema=False)
def get_spotlight():
    html_content = """
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <title>CodeCity API Docs</title>
        <!-- Embed elements Elements via Web Component -->
        <script src="https://unpkg.com/@stoplight/elements/web-components.min.js"></script>
        <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css">
        <style>
            #elements-api {
                display: block;
                height: 100vh;
            }
        </style>
    </head>
    <body>

        <elements-api
            id="elements-api"
            apiDescriptionUrl="http://0.0.0.0:8000/openapi.json"
            router="hash"
            layout="sidebar"
        />

    </body>
    </html>
    """

    return HTMLResponse(content=html_content, status_code=200)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="CodeCity API",
        version="0.1.0",
        summary="This is a very custom OpenAPI schema",
        description="Here's a longer description of the custom **OpenAPI** schema",
        routes=app.routes,
    )

    # openapi_schema["info"]["x-logo"] = {
    #     "url": "https://fastapi.tiangolo.com/img/logo-margin/logo-teal.png"
    # }

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000)
