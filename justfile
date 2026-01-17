set positional-arguments
set dotenv-load


project_dir := justfile_dir()

default:
  just --list

# General Aliases
# --------------------------------------------------------------------------------------------------
uv *args='':
  cd "{{ api_dir }}"; infisical run --env=dev  -- uv $@;

django-admin *args='':
  cd "{{ api_dir }}"; infisical run --env=dev  -- uv run django-admin $@;

manage *args='':
  cd "{{ api_dir }}"; infisical run --env=dev  -- uv run manage.py $@;

# Project specific commands
# --------------------------------------------------------------------------------------------------
login:
  cd "{{ project_dir }}"; infisical login

start-api:
  cd "{{ api_dir }}"; infisical run --env=dev  -- uv run manage.py runserver

start-celery:
  cd "{{ api_dir }}"; infisical run --env=dev  -- uv run celery -A api worker -l INFO -Q default --concurrency=1

purge-celery:
  cd "{{ api_dir }}"; infisical run --env=dev  -- uv run celery -A api purge -f -Q default

restart-celery:
  cd "{{ api_dir }}"; infisical run --env=dev  -- just purge-celery && just start-celery

collectstatic:
   cd "{{ api_dir }}"; infisical run --env=dev -- uv run python manage.py collectstatic --noinput

init:
  cd "{{ api_dir }}"; infisical run --env=dev -- uv sync --locked
  cd "{{ api_dir }}"; infisical run --env=dev -- pre-commit install
  cd "{{ api_dir }}"; infisical run --env=dev -- uv run manage.py migrate
  # cd "{{ api_dir }}"; infisical run --env=dev -- uv run manage.py loaddata local_dev
  cd "{{ api_dir }}"; infisical run --env=dev -- uv run python manage.py collectstatic --noinput
