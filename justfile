set positional-arguments
set dotenv-load

project_dir := justfile_dir()

default:
  @just --list

# Install dependencies for local development
setup:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ project_dir }}"

  echo "Checking for required tools..."

  # Check for uv
  if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    echo "Please restart your shell or run: source ~/.bashrc (or ~/.zshrc)"
  else
    echo "✓ uv is installed"
  fi

  # Check for pre-commit
  if ! command -v pre-commit &> /dev/null; then
    echo "Installing pre-commit..."
    uv tool install pre-commit
  else
    echo "✓ pre-commit is installed"
  fi

  echo ""
  echo "Setting up project..."
  uv sync
  pre-commit install

  echo ""
  echo "✓ Setup complete! Run 'just serve' to start the dev server."

# Initialize project (sync dependencies and install hooks)
init:
  @cd "{{ project_dir }}"
  uv sync --locked
  pre-commit install

# Run the development server
serve *args='':
  @cd "{{ project_dir }}"
  uv run codecity serve . $@

# Build static site
build *args='':
  @cd "{{ project_dir }}"
  uv run codecity build . $@

# Run tests
test *args='':
  @cd "{{ project_dir }}"
  uv run pytest src/ $@

# Run linting
lint:
  @cd "{{ project_dir }}"
  uv run ruff check src/
  uv run ruff format --check src/

# Fix linting issues
lint-fix:
  @cd "{{ project_dir }}"
  uv run ruff check --fix src/
  uv run ruff format src/

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
