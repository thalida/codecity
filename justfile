set positional-arguments
set dotenv-load


project_dir := justfile_dir()

default:
  @just --list

init:
  @cd "{{ project_dir }}"
  uv sync --locked
  pre-commit install

# ==============================================================================
#   DOCS
# ------------------------------------------------------------------------------
start-docs:
  @cd "{{ project_dir }}"
  @uv run mike serve
  # @uv run mkdocs serve

deploy-docs *args='':
  @cd "{{ project_dir }}";
  @export VERSION=$(uv version --short) && uv run mike deploy $VERSION

mike *args='':
  @cd "{{ project_dir }}";
  @uv run mike $@;
