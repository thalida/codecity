#!/usr/bin/env bash

cd $WORKSPACE_FOLDER
pre-commit install

cd $WORKSPACE_FOLDER/api
uv sync

# cd $WORKSPACE_FOLDER/app
# npm install
