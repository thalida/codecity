set positional-arguments
set dotenv-load


project_dir := justfile_dir()

default:
  just --list

init:
  cd "{{ project_dir }}"; uv sync --locked
  cd "{{ project_dir }}"; pre-commit install
