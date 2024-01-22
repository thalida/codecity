import json

from fastapi.openapi.utils import get_openapi

from api import app

with open("openapi.json", "w") as f:
    openapi_content = get_openapi(
        title=app.title,
        version=app.version,
        openapi_version=app.openapi_version,
        description=app.description,
        routes=app.routes,
    )
    for path_data in openapi_content["paths"].values():
        for operation in path_data.values():
            if "tags" not in operation or len(operation["tags"]) == 0:
                continue

            tag = operation["tags"][0]
            operation_id = operation["operationId"]
            to_remove = f"{tag}-"
            new_operation_id = operation_id[len(to_remove) :]
            operation["operationId"] = new_operation_id

    f.write(json.dumps(openapi_content, indent=2))
