default:
    @just --list

setup:
    uv sync
    cd web && npm install

dev: setup
    uv run codecity --dev
