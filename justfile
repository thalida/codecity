default:
    @just --list

setup:
    uv sync
    cd web && npm install

dev:
    uv run codecity --dev
