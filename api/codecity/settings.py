import os
import pathlib

from dotenv import load_dotenv

load_dotenv()

DISABLE_CACHE = os.getenv("DISABLE_CACHE", False)
CACHE_TTL = os.getenv("CACHE_TTL", 60 * 60)  # 1 hour

if DISABLE_CACHE:
    CACHE_TTL = 0

CACHE_PARENT_DIR = pathlib.Path(__file__).parent / "cache"
CACHE_FILENAME = "response.json"
CACHE_REPO_DIR = "src"
