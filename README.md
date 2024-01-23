# codecity

## Development

Run api:
```sh
poetry run uvicorn api:app --reload --host 0.0.0.0 --port 8000
```


Run app:
```sh
npm run server
```


## Generate Open API Specs & Code

In api directory:
```sh
python generate_openapi.py
```

In app directory:
```sh
npm run generate-api-client
```
