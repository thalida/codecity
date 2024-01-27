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


## Celery, RabbitMQ, Flower

Celery:
```sh
celery -A main.celery worker --loglevel=info -Q codecity
```

Flower:
```sh
celery -A main.celery flower --port=5555 --broker_api="http://guest:guest@0.0.0.0:15672/api/"
```
http://0.0.0.0:5555/broker

RabbitMQ:
http://localhost:15672/#/queues
