from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, JSONResponse

import repo

app = FastAPI(docs_url=None, redoc_url=None, openapi_url="/openapi.json")

origins = [
    "http://localhost",
    "http://localhost:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
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


@app.get("/repos")
def get_repo(repo_url: str):
    try:
        response = repo.get_repo(repo_url)
        return JSONResponse(content=response, status_code=status.HTTP_200_OK)
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)}, status_code=status.HTTP_400_BAD_REQUEST
        )


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
