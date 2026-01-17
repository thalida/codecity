#!/usr/bin/env bash

cd $WORKSPACE_FOLDER
pre-commit install
uv sync

# cd $WORKSPACE_FOLDER/app
# npm install
