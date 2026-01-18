# src/codecity/analysis/cache.py
import hashlib
import json
from pathlib import Path
from typing import Any


class AnalysisCache:
    def __init__(self, cache_dir: Path, repo_path: str) -> None:
        self.cache_dir = cache_dir
        self.repo_hash = self._hash_repo_path(repo_path)
        self.repo_cache_dir = cache_dir / self.repo_hash
        self.repo_cache_dir.mkdir(parents=True, exist_ok=True)

    def _hash_repo_path(self, repo_path: str) -> str:
        """Create a short hash of the repo path for cache directory name."""
        return hashlib.sha256(repo_path.encode()).hexdigest()[:12]

    def _cache_file(self, name: str) -> Path:
        safe_name = name.replace("/", "_").replace("\\", "_")
        return self.repo_cache_dir / f"{safe_name}.json"

    def save(self, name: str, data: dict[str, Any]) -> None:
        """Save data to cache."""
        cache_file = self._cache_file(name)
        cache_file.write_text(json.dumps(data, default=str, indent=2))

    def load(self, name: str) -> dict[str, Any] | None:
        """Load data from cache, returns None if not found."""
        cache_file = self._cache_file(name)
        if not cache_file.exists():
            return None

        try:
            return json.loads(cache_file.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def invalidate(self, name: str) -> None:
        """Remove a specific cache file."""
        cache_file = self._cache_file(name)
        if cache_file.exists():
            cache_file.unlink()

    def invalidate_all(self) -> None:
        """Remove all cache files for this repo."""
        if self.repo_cache_dir.exists():
            for f in self.repo_cache_dir.iterdir():
                if f.is_file():
                    f.unlink()
