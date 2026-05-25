default:
    @just --list

setup:
    uv sync
    cd app && npm install

dev: setup
    uv run codecity --dev
