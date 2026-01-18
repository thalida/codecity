# src/codecity/app/__init__.py
from pathlib import Path

from codecity.app.builder import build_static_site

APP_DIR = Path(__file__).parent

__all__ = ["APP_DIR", "build_static_site"]
