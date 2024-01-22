import os

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.routing import APIRoute

from models import (
    CodeCity,
    CodeCityNode,
    CodeCityRepoOverview,
)

os.environ["TZ"] = "UTC"

load_dotenv()


def custom_generate_unique_id(route: APIRoute):
    if route.tags is None or len(route.tags) == 0:
        return route.name

    return f"{route.tags[0]}-{route.name}"


DEBUG = os.environ.get("DEBUG", False)
DEBUG = True if DEBUG == "True" or DEBUG == 1 else False

app = FastAPI(
    debug=DEBUG,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
)

origins = [
    "http://localhost",
    "http://localhost:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
)


@app.get("/repo-overview")
def get_repo_overview(repo_url: str) -> CodeCityRepoOverview:
    codecity = CodeCity(repo_url=repo_url)
    return codecity.fetch_repo_overview()


@app.get("/repo-tree", response_model=list[CodeCityNode])
def get_repo_tree(repo_url: str):
    codecity = CodeCity(repo_url=repo_url)

    def stream():
        for node in codecity.iter_tree():
            yield node.model_dump_json(
                indent=2 if app.debug else None,
            )

    return StreamingResponse(
        stream(),  # type: ignore
        media_type="application/json",
    )


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
            apiDescriptionUrl="http://localhost:8001/openapi.json"
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
