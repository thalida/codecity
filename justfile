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

  # Check for fnm (Node.js version manager)
  if ! command -v fnm &> /dev/null; then
    echo "Installing fnm..."
    curl -fsSL https://fnm.vercel.app/install | bash
    echo "Please restart your shell and run 'just setup' again"
    exit 0
  else
    echo "✓ fnm is installed"
  fi

  # Check for Node.js
  if ! command -v node &> /dev/null; then
    echo "Installing Node.js LTS..."
    fnm install --lts
    fnm use lts-latest
  else
    echo "✓ Node.js is installed ($(node --version))"
  fi

  echo ""
  echo "Setting up project..."
  uv sync
  pre-commit install
  npm --prefix src/codecity/app install

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

# Run tests (Python and JavaScript)
test *args='':
  @cd "{{ project_dir }}"
  uv run pytest src/ $@
  npm --prefix src/codecity/app test

# Run JavaScript tests only
test-js *args='':
  @cd "{{ project_dir }}"
  npm --prefix src/codecity/app test $@

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

# Run type checking
typecheck:
  @cd "{{ project_dir }}"
  uv run mypy src/

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
