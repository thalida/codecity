import os
import pathlib

from dotenv import load_dotenv

load_dotenv()

DISABLE_CACHE = os.getenv("DISABLE_CACHE", False)

CACHE_PARENT_DIR = pathlib.Path(__file__).parent / "cache"
CACHE_REPO_DIR = "src"
