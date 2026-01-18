# CodeCity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a 3D city visualization tool that renders codebases as interactive cities where files become buildings and folders become streets.

**Architecture:** Python CLI analyzes git repos and serves/builds a Babylon.js web viewer. WebSocket enables live reload when files change. Configuration supports multiple editors and caching strategies.

**Tech Stack:** Python (rich-click, Pydantic, FastAPI, uvicorn), Babylon.js, Vite, platformdirs, watchfiles

---

## Phase 1: Foundation - Project Structure & Configuration

### Task 1.1: Add Dependencies

**Files:**
- Modify: `pyproject.toml`

**Step 1: Add required dependencies**

Add to `pyproject.toml` dependencies list:

```toml
dependencies = [
    # ... existing deps ...
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "watchfiles>=1.0.0",
    "platformdirs>=4.3.0",
    "tomli>=2.2.0",
    "tomli-w>=1.2.0",
]
```

**Step 2: Add dev dependencies**

```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.28.0",
]
```

**Step 3: Install dependencies**

Run: `uv sync`
Expected: Dependencies install successfully

**Step 4: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "feat: add fastapi, uvicorn, watchfiles, platformdirs dependencies"
```

---

### Task 1.2: Create Config Module - Settings Model

**Files:**
- Create: `src/codecity/config/__init__.py`
- Create: `src/codecity/config/settings.py`
- Create: `src/codecity/config/tests/__init__.py`
- Create: `src/codecity/config/tests/test_settings.py`

**Step 1: Create config package init**

```python
# src/codecity/config/__init__.py
from codecity.config.settings import Settings

__all__ = ["Settings"]
```

**Step 2: Write failing test for Settings**

```python
# src/codecity/config/tests/test_settings.py
from pathlib import Path

import pytest

from codecity.config import Settings


def test_settings_default_values() -> None:
    settings = Settings()
    assert settings.editor == "vscode"
    assert settings.port == 3000
    assert settings.debug is False


def test_settings_cache_dir_uses_platformdirs() -> None:
    settings = Settings()
    # Should be in user cache dir, not current directory
    assert "codecity" in str(settings.cache_dir).lower()


def test_settings_config_path_uses_platformdirs() -> None:
    settings = Settings()
    assert "codecity" in str(settings.config_path).lower()
```

**Step 3: Run test to verify it fails**

Run: `pytest src/codecity/config/tests/test_settings.py -v`
Expected: FAIL with import error

**Step 4: Write Settings implementation**

```python
# src/codecity/config/settings.py
from pathlib import Path
from typing import Literal

import platformdirs
from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

EditorType = Literal["vscode", "cursor", "idea", "webstorm", "vim", "custom"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CODECITY_",
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        case_sensitive=False,
        extra="ignore",
    )

    # Editor settings
    editor: EditorType = "vscode"
    editor_custom_command: str | None = None

    # Server settings
    port: int = 3000
    open_browser: bool = False

    # Build settings
    out_dir: Path = Path("./codecity-dist")

    # Debug
    debug: bool = False

    # Override paths (None = use platformdirs defaults)
    cache_dir_override: Path | None = Field(default=None, alias="cache_dir")
    config_path_override: Path | None = Field(default=None, alias="config")

    @computed_field
    @property
    def cache_dir(self) -> Path:
        if self.cache_dir_override:
            return self.cache_dir_override
        return Path(platformdirs.user_cache_dir("codecity"))

    @computed_field
    @property
    def config_path(self) -> Path:
        if self.config_path_override:
            return self.config_path_override
        return Path(platformdirs.user_config_dir("codecity")) / "config.toml"
```

**Step 5: Create test package init**

```python
# src/codecity/config/tests/__init__.py
```

**Step 6: Run test to verify it passes**

Run: `pytest src/codecity/config/tests/test_settings.py -v`
Expected: PASS

**Step 7: Commit**

```bash
git add src/codecity/config/
git commit -m "feat(config): add Settings model with platformdirs integration"
```

---

### Task 1.3: Create Config Module - Defaults & Editor Mappings

**Files:**
- Create: `src/codecity/config/defaults.py`
- Modify: `src/codecity/config/__init__.py`
- Create: `src/codecity/config/tests/test_defaults.py`

**Step 1: Write failing test for editor URL generation**

```python
# src/codecity/config/tests/test_defaults.py
from codecity.config.defaults import get_editor_url, LANGUAGE_COLORS


def test_get_editor_url_vscode() -> None:
    url = get_editor_url("vscode", "/path/to/file.py", 42)
    assert url == "vscode://file//path/to/file.py:42"


def test_get_editor_url_cursor() -> None:
    url = get_editor_url("cursor", "/path/to/file.py", 10)
    assert url == "cursor://file//path/to/file.py:10"


def test_get_editor_url_custom() -> None:
    url = get_editor_url("custom", "/path/to/file.py", 5, "nvim +{line} {file}")
    assert url == "nvim +5 /path/to/file.py"


def test_language_colors_has_common_languages() -> None:
    assert "python" in LANGUAGE_COLORS
    assert "javascript" in LANGUAGE_COLORS
    assert "typescript" in LANGUAGE_COLORS
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/config/tests/test_defaults.py -v`
Expected: FAIL with import error

**Step 3: Write defaults implementation**

```python
# src/codecity/config/defaults.py
from typing import Literal

EditorType = Literal["vscode", "cursor", "idea", "webstorm", "vim", "custom"]

EDITOR_URL_TEMPLATES: dict[str, str] = {
    "vscode": "vscode://file/{file}:{line}",
    "cursor": "cursor://file/{file}:{line}",
    "idea": "jetbrains://idea/navigate/reference?path={file}&line={line}",
    "webstorm": "jetbrains://webstorm/navigate/reference?path={file}&line={line}",
    "vim": "nvim +{line} {file}",
}

# Hue values (0-360) for HSL color mapping
LANGUAGE_COLORS: dict[str, int] = {
    "python": 210,      # Blue
    "javascript": 50,   # Yellow
    "typescript": 200,  # Light blue
    "java": 30,         # Orange
    "go": 180,          # Cyan
    "rust": 15,         # Red-orange
    "ruby": 0,          # Red
    "php": 260,         # Purple
    "c": 220,           # Steel blue
    "cpp": 220,         # Steel blue
    "csharp": 270,      # Violet
    "swift": 25,        # Orange
    "kotlin": 280,      # Purple
    "scala": 0,         # Red
    "html": 15,         # Orange-red
    "css": 200,         # Light blue
    "scss": 330,        # Pink
    "json": 45,         # Gold
    "yaml": 120,        # Green
    "markdown": 150,    # Teal
    "shell": 100,       # Yellow-green
    "sql": 190,         # Cyan
    "unknown": 0,       # Gray (will use low saturation)
}

EXTENSION_TO_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".jsx": "javascript",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "scss",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".sql": "sql",
}


def get_editor_url(
    editor: EditorType,
    file_path: str,
    line: int = 1,
    custom_command: str | None = None,
) -> str:
    if editor == "custom" and custom_command:
        template = custom_command
    else:
        template = EDITOR_URL_TEMPLATES.get(editor, EDITOR_URL_TEMPLATES["vscode"])

    return template.format(file=file_path, line=line)


def get_language_from_extension(extension: str) -> str:
    return EXTENSION_TO_LANGUAGE.get(extension.lower(), "unknown")


def get_language_hue(language: str) -> int:
    return LANGUAGE_COLORS.get(language.lower(), LANGUAGE_COLORS["unknown"])
```

**Step 4: Update config __init__.py**

```python
# src/codecity/config/__init__.py
from codecity.config.defaults import (
    EXTENSION_TO_LANGUAGE,
    LANGUAGE_COLORS,
    get_editor_url,
    get_language_from_extension,
    get_language_hue,
)
from codecity.config.settings import Settings

__all__ = [
    "Settings",
    "get_editor_url",
    "get_language_from_extension",
    "get_language_hue",
    "LANGUAGE_COLORS",
    "EXTENSION_TO_LANGUAGE",
]
```

**Step 5: Run test to verify it passes**

Run: `pytest src/codecity/config/tests/test_defaults.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add src/codecity/config/
git commit -m "feat(config): add editor URL templates and language color mappings"
```

---

## Phase 2: Analysis Engine

### Task 2.1: Create Analysis Models

**Files:**
- Create: `src/codecity/analysis/__init__.py`
- Create: `src/codecity/analysis/models.py`
- Create: `src/codecity/analysis/tests/__init__.py`
- Create: `src/codecity/analysis/tests/test_models.py`

**Step 1: Write failing test for models**

```python
# src/codecity/analysis/tests/test_models.py
from datetime import datetime, timezone

from codecity.analysis.models import FileMetrics, Building, Street, City


def test_file_metrics_creation() -> None:
    now = datetime.now(timezone.utc)
    metrics = FileMetrics(
        path="src/main.py",
        lines_of_code=100,
        avg_line_length=45.5,
        language="python",
        created_at=now,
        last_modified=now,
    )
    assert metrics.path == "src/main.py"
    assert metrics.lines_of_code == 100
    assert metrics.language == "python"


def test_building_from_file_metrics() -> None:
    now = datetime.now(timezone.utc)
    metrics = FileMetrics(
        path="src/main.py",
        lines_of_code=100,
        avg_line_length=40.0,
        language="python",
        created_at=now,
        last_modified=now,
    )
    building = Building.from_metrics(metrics)
    assert building.height == 100
    assert building.width == 40.0
    assert building.file_path == "src/main.py"


def test_street_can_contain_buildings() -> None:
    street = Street(path="src/", name="src")
    assert street.buildings == []
    assert street.substreets == []


def test_city_has_root_street() -> None:
    city = City(root=Street(path="", name="root"))
    assert city.root.name == "root"
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/analysis/tests/test_models.py -v`
Expected: FAIL with import error

**Step 3: Write models implementation**

```python
# src/codecity/analysis/models.py
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class FileMetrics:
    path: str
    lines_of_code: int
    avg_line_length: float
    language: str
    created_at: datetime
    last_modified: datetime


@dataclass
class Building:
    file_path: str
    height: float  # lines of code
    width: float   # avg line length
    depth: float   # same as width
    language: str
    created_at: datetime
    last_modified: datetime
    x: float = 0.0
    z: float = 0.0

    @classmethod
    def from_metrics(cls, metrics: FileMetrics) -> "Building":
        return cls(
            file_path=metrics.path,
            height=float(metrics.lines_of_code),
            width=metrics.avg_line_length,
            depth=metrics.avg_line_length,
            language=metrics.language,
            created_at=metrics.created_at,
            last_modified=metrics.last_modified,
        )


@dataclass
class Street:
    path: str
    name: str
    x: float = 0.0
    z: float = 0.0
    width: float = 10.0
    length: float = 100.0
    buildings: list[Building] = field(default_factory=list)
    substreets: list["Street"] = field(default_factory=list)


@dataclass
class City:
    root: Street
    repo_path: str = ""
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
```

**Step 4: Create package init files**

```python
# src/codecity/analysis/__init__.py
from codecity.analysis.models import Building, City, FileMetrics, Street

__all__ = ["FileMetrics", "Building", "Street", "City"]
```

```python
# src/codecity/analysis/tests/__init__.py
```

**Step 5: Run test to verify it passes**

Run: `pytest src/codecity/analysis/tests/test_models.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add src/codecity/analysis/
git commit -m "feat(analysis): add core data models for FileMetrics, Building, Street, City"
```

---

### Task 2.2: Create Metrics Module

**Files:**
- Create: `src/codecity/analysis/metrics.py`
- Create: `src/codecity/analysis/tests/test_metrics.py`

**Step 1: Write failing test for metrics calculation**

```python
# src/codecity/analysis/tests/test_metrics.py
from pathlib import Path
import tempfile

from codecity.analysis.metrics import calculate_file_metrics


def test_calculate_lines_of_code() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("line 1\n")
        f.write("line 2\n")
        f.write("line 3\n")
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["lines_of_code"] == 3


def test_calculate_avg_line_length() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("1234567890\n")  # 10 chars
        f.write("12345\n")       # 5 chars
        f.write("123456789012345\n")  # 15 chars
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["avg_line_length"] == 10.0  # (10+5+15)/3


def test_detect_language_from_extension() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("print('hello')\n")
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["language"] == "python"


def test_empty_file_returns_zero_metrics() -> None:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.flush()

        metrics = calculate_file_metrics(Path(f.name))
        assert metrics["lines_of_code"] == 0
        assert metrics["avg_line_length"] == 0.0
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/analysis/tests/test_metrics.py -v`
Expected: FAIL with import error

**Step 3: Write metrics implementation**

```python
# src/codecity/analysis/metrics.py
from pathlib import Path
from typing import TypedDict

from codecity.config.defaults import get_language_from_extension


class FileMetricsDict(TypedDict):
    lines_of_code: int
    avg_line_length: float
    language: str


def calculate_file_metrics(file_path: Path) -> FileMetricsDict:
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except (OSError, UnicodeDecodeError):
        return {
            "lines_of_code": 0,
            "avg_line_length": 0.0,
            "language": "unknown",
        }

    lines = content.splitlines()
    lines_of_code = len(lines)

    if lines_of_code == 0:
        avg_line_length = 0.0
    else:
        total_length = sum(len(line) for line in lines)
        avg_line_length = total_length / lines_of_code

    language = get_language_from_extension(file_path.suffix)

    return {
        "lines_of_code": lines_of_code,
        "avg_line_length": round(avg_line_length, 2),
        "language": language,
    }
```

**Step 4: Run test to verify it passes**

Run: `pytest src/codecity/analysis/tests/test_metrics.py -v`
Expected: PASS

**Step 5: Update analysis __init__.py**

```python
# src/codecity/analysis/__init__.py
from codecity.analysis.metrics import calculate_file_metrics
from codecity.analysis.models import Building, City, FileMetrics, Street

__all__ = ["FileMetrics", "Building", "Street", "City", "calculate_file_metrics"]
```

**Step 6: Commit**

```bash
git add src/codecity/analysis/
git commit -m "feat(analysis): add file metrics calculation (LOC, avg line length, language)"
```

---

### Task 2.3: Create Git Module

**Files:**
- Create: `src/codecity/analysis/git.py`
- Create: `src/codecity/analysis/tests/test_git.py`

**Step 1: Write failing test for git history**

```python
# src/codecity/analysis/tests/test_git.py
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from codecity.analysis.git import get_file_git_history, get_repo_files


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Create a temporary git repo with some commits."""
    subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=tmp_path,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=tmp_path,
        capture_output=True,
    )

    # Create a file and commit
    test_file = tmp_path / "test.py"
    test_file.write_text("print('hello')\n")
    subprocess.run(["git", "add", "test.py"], cwd=tmp_path, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=tmp_path,
        capture_output=True,
    )

    return tmp_path


def test_get_repo_files_returns_tracked_files(git_repo: Path) -> None:
    files = get_repo_files(git_repo)
    assert "test.py" in files


def test_get_repo_files_excludes_untracked(git_repo: Path) -> None:
    (git_repo / "untracked.py").write_text("# untracked\n")
    files = get_repo_files(git_repo)
    assert "untracked.py" not in files


def test_get_file_git_history_returns_dates(git_repo: Path) -> None:
    history = get_file_git_history(git_repo, "test.py")
    assert "created_at" in history
    assert "last_modified" in history
    assert isinstance(history["created_at"], datetime)
    assert isinstance(history["last_modified"], datetime)
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/analysis/tests/test_git.py -v`
Expected: FAIL with import error

**Step 3: Write git implementation**

```python
# src/codecity/analysis/git.py
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict


class GitHistoryDict(TypedDict):
    created_at: datetime
    last_modified: datetime


def get_repo_files(repo_path: Path) -> list[str]:
    """Get list of all tracked files in the repository."""
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []

    return [f for f in result.stdout.strip().split("\n") if f]


def get_file_git_history(repo_path: Path, file_path: str) -> GitHistoryDict:
    """Get creation and last modification dates from git history."""
    now = datetime.now(timezone.utc)

    # Get first commit date (creation)
    result = subprocess.run(
        [
            "git", "log", "--diff-filter=A", "--follow",
            "--format=%aI", "--", file_path
        ],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        lines = result.stdout.strip().split("\n")
        created_at = datetime.fromisoformat(lines[-1])
    else:
        created_at = now

    # Get last commit date (modification)
    result = subprocess.run(
        ["git", "log", "-1", "--format=%aI", "--", file_path],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        last_modified = datetime.fromisoformat(result.stdout.strip())
    else:
        last_modified = now

    return {
        "created_at": created_at,
        "last_modified": last_modified,
    }


def get_current_branch(repo_path: Path) -> str:
    """Get the current branch name."""
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return "main"


def get_remote_url(repo_path: Path) -> str | None:
    """Get the origin remote URL if it exists."""
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return None
```

**Step 4: Run test to verify it passes**

Run: `pytest src/codecity/analysis/tests/test_git.py -v`
Expected: PASS

**Step 5: Update analysis __init__.py**

```python
# src/codecity/analysis/__init__.py
from codecity.analysis.git import (
    get_current_branch,
    get_file_git_history,
    get_remote_url,
    get_repo_files,
)
from codecity.analysis.metrics import calculate_file_metrics
from codecity.analysis.models import Building, City, FileMetrics, Street

__all__ = [
    "FileMetrics",
    "Building",
    "Street",
    "City",
    "calculate_file_metrics",
    "get_repo_files",
    "get_file_git_history",
    "get_current_branch",
    "get_remote_url",
]
```

**Step 6: Commit**

```bash
git add src/codecity/analysis/
git commit -m "feat(analysis): add git module for file history and repo info"
```

---

### Task 2.4: Create Cache Module

**Files:**
- Create: `src/codecity/analysis/cache.py`
- Create: `src/codecity/analysis/tests/test_cache.py`

**Step 1: Write failing test for cache**

```python
# src/codecity/analysis/tests/test_cache.py
import json
import tempfile
from pathlib import Path

from codecity.analysis.cache import AnalysisCache


def test_cache_save_and_load() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")

        data = {"test": "value", "number": 42}
        cache.save("analysis", data)

        loaded = cache.load("analysis")
        assert loaded == data


def test_cache_returns_none_for_missing() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")
        assert cache.load("nonexistent") is None


def test_cache_uses_repo_hash_subdir() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")
        cache.save("test", {"key": "value"})

        # Should create a subdirectory based on repo path hash
        subdirs = list(Path(tmpdir).iterdir())
        assert len(subdirs) == 1
        assert subdirs[0].is_dir()


def test_cache_invalidate() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AnalysisCache(Path(tmpdir), "/fake/repo/path")

        cache.save("test", {"key": "value"})
        assert cache.load("test") is not None

        cache.invalidate("test")
        assert cache.load("test") is None
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/analysis/tests/test_cache.py -v`
Expected: FAIL with import error

**Step 3: Write cache implementation**

```python
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
        return self.repo_cache_dir / f"{name}.json"

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
                f.unlink()
```

**Step 4: Run test to verify it passes**

Run: `pytest src/codecity/analysis/tests/test_cache.py -v`
Expected: PASS

**Step 5: Update analysis __init__.py**

```python
# src/codecity/analysis/__init__.py
from codecity.analysis.cache import AnalysisCache
from codecity.analysis.git import (
    get_current_branch,
    get_file_git_history,
    get_remote_url,
    get_repo_files,
)
from codecity.analysis.metrics import calculate_file_metrics
from codecity.analysis.models import Building, City, FileMetrics, Street

__all__ = [
    "FileMetrics",
    "Building",
    "Street",
    "City",
    "calculate_file_metrics",
    "get_repo_files",
    "get_file_git_history",
    "get_current_branch",
    "get_remote_url",
    "AnalysisCache",
]
```

**Step 6: Commit**

```bash
git add src/codecity/analysis/
git commit -m "feat(analysis): add cache module for storing analysis results"
```

---

### Task 2.5: Create Layout Algorithm

**Files:**
- Create: `src/codecity/analysis/layout.py`
- Create: `src/codecity/analysis/tests/test_layout.py`

**Step 1: Write failing test for layout**

```python
# src/codecity/analysis/tests/test_layout.py
from datetime import datetime, timezone

from codecity.analysis.layout import generate_city_layout
from codecity.analysis.models import FileMetrics


def test_layout_generates_city_from_metrics() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    assert city.root is not None
    assert city.repo_path == "/repo/path"


def test_layout_creates_streets_for_folders() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils/helpers.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")

    # Root should have 'src' street
    assert len(city.root.substreets) == 1
    src_street = city.root.substreets[0]
    assert src_street.name == "src"


def test_layout_places_buildings_on_streets() -> None:
    now = datetime.now(timezone.utc)
    files = [
        FileMetrics(
            path="main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="python",
            created_at=now,
            last_modified=now,
        ),
    ]

    city = generate_city_layout(files, "/repo/path")
    assert len(city.root.buildings) == 1
    assert city.root.buildings[0].file_path == "main.py"
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/analysis/tests/test_layout.py -v`
Expected: FAIL with import error

**Step 3: Write layout implementation**

```python
# src/codecity/analysis/layout.py
from pathlib import PurePosixPath

from codecity.analysis.models import Building, City, FileMetrics, Street


def generate_city_layout(files: list[FileMetrics], repo_path: str) -> City:
    """Generate a city layout from file metrics."""
    root = Street(path="", name="root")

    for file_metrics in files:
        _add_file_to_city(root, file_metrics)

    _calculate_positions(root, 0, 0)

    return City(root=root, repo_path=repo_path)


def _add_file_to_city(root: Street, metrics: FileMetrics) -> None:
    """Add a file to the city structure, creating streets as needed."""
    path = PurePosixPath(metrics.path)
    parts = path.parts

    current_street = root

    # Navigate/create streets for each folder in the path
    for i, part in enumerate(parts[:-1]):
        street_path = "/".join(parts[: i + 1])
        existing = next(
            (s for s in current_street.substreets if s.name == part),
            None,
        )

        if existing:
            current_street = existing
        else:
            new_street = Street(path=street_path, name=part)
            current_street.substreets.append(new_street)
            current_street = new_street

    # Add the building to the final street
    building = Building.from_metrics(metrics)
    current_street.buildings.append(building)


def _calculate_positions(street: Street, start_x: float, start_z: float) -> tuple[float, float]:
    """Calculate positions for streets and buildings. Returns (width, depth) used."""
    street.x = start_x
    street.z = start_z

    current_x = start_x + 5  # Street margin
    max_z = start_z

    # Place buildings along the street
    building_z = start_z + 5  # Offset from street
    for building in street.buildings:
        building.x = current_x
        building.z = building_z
        current_x += building.width + 3  # Building width + gap
        max_z = max(max_z, building_z + building.depth)

    # Place substreets
    substreet_x = start_x
    substreet_z = max_z + 10  # Gap after buildings

    for substreet in street.substreets:
        w, d = _calculate_positions(substreet, substreet_x, substreet_z)
        substreet_x += w + 10  # Gap between substreets

    street.width = max(current_x - start_x, substreet_x - start_x)
    street.length = max(max_z - start_z, 20)

    return street.width, street.length
```

**Step 4: Run test to verify it passes**

Run: `pytest src/codecity/analysis/tests/test_layout.py -v`
Expected: PASS

**Step 5: Update analysis __init__.py**

```python
# src/codecity/analysis/__init__.py
from codecity.analysis.cache import AnalysisCache
from codecity.analysis.git import (
    get_current_branch,
    get_file_git_history,
    get_remote_url,
    get_repo_files,
)
from codecity.analysis.layout import generate_city_layout
from codecity.analysis.metrics import calculate_file_metrics
from codecity.analysis.models import Building, City, FileMetrics, Street

__all__ = [
    "FileMetrics",
    "Building",
    "Street",
    "City",
    "calculate_file_metrics",
    "get_repo_files",
    "get_file_git_history",
    "get_current_branch",
    "get_remote_url",
    "AnalysisCache",
    "generate_city_layout",
]
```

**Step 6: Commit**

```bash
git add src/codecity/analysis/
git commit -m "feat(analysis): add city layout algorithm"
```

---

### Task 2.6: Create Diff Calculator

**Files:**
- Create: `src/codecity/analysis/diff.py`
- Create: `src/codecity/analysis/tests/test_diff.py`

**Step 1: Write failing test for diff**

```python
# src/codecity/analysis/tests/test_diff.py
from codecity.analysis.diff import calculate_diff, DiffResult


def test_diff_detects_added_files() -> None:
    old_files = {"a.py", "b.py"}
    new_files = {"a.py", "b.py", "c.py"}

    diff = calculate_diff(old_files, new_files)
    assert diff.added == {"c.py"}
    assert diff.removed == set()
    assert diff.modified == set()


def test_diff_detects_removed_files() -> None:
    old_files = {"a.py", "b.py", "c.py"}
    new_files = {"a.py", "b.py"}

    diff = calculate_diff(old_files, new_files)
    assert diff.added == set()
    assert diff.removed == {"c.py"}


def test_diff_with_modified_hints() -> None:
    old_files = {"a.py", "b.py"}
    new_files = {"a.py", "b.py"}
    modified_hints = {"a.py"}  # From file watcher

    diff = calculate_diff(old_files, new_files, modified_hints)
    assert diff.modified == {"a.py"}


def test_diff_is_empty_returns_true_when_no_changes() -> None:
    diff = DiffResult(added=set(), removed=set(), modified=set())
    assert diff.is_empty is True


def test_diff_is_empty_returns_false_when_changes() -> None:
    diff = DiffResult(added={"a.py"}, removed=set(), modified=set())
    assert diff.is_empty is False
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/analysis/tests/test_diff.py -v`
Expected: FAIL with import error

**Step 3: Write diff implementation**

```python
# src/codecity/analysis/diff.py
from dataclasses import dataclass, field


@dataclass
class DiffResult:
    added: set[str] = field(default_factory=set)
    removed: set[str] = field(default_factory=set)
    modified: set[str] = field(default_factory=set)

    @property
    def is_empty(self) -> bool:
        return not self.added and not self.removed and not self.modified

    @property
    def all_changed(self) -> set[str]:
        return self.added | self.removed | self.modified


def calculate_diff(
    old_files: set[str],
    new_files: set[str],
    modified_hints: set[str] | None = None,
) -> DiffResult:
    """Calculate the difference between two sets of files."""
    added = new_files - old_files
    removed = old_files - new_files

    # Modified files are those in both sets that are marked as modified
    if modified_hints:
        modified = modified_hints & old_files & new_files
    else:
        modified = set()

    return DiffResult(added=added, removed=removed, modified=modified)
```

**Step 4: Run test to verify it passes**

Run: `pytest src/codecity/analysis/tests/test_diff.py -v`
Expected: PASS

**Step 5: Update analysis __init__.py**

```python
# src/codecity/analysis/__init__.py
from codecity.analysis.cache import AnalysisCache
from codecity.analysis.diff import DiffResult, calculate_diff
from codecity.analysis.git import (
    get_current_branch,
    get_file_git_history,
    get_remote_url,
    get_repo_files,
)
from codecity.analysis.layout import generate_city_layout
from codecity.analysis.metrics import calculate_file_metrics
from codecity.analysis.models import Building, City, FileMetrics, Street

__all__ = [
    "FileMetrics",
    "Building",
    "Street",
    "City",
    "calculate_file_metrics",
    "get_repo_files",
    "get_file_git_history",
    "get_current_branch",
    "get_remote_url",
    "AnalysisCache",
    "generate_city_layout",
    "calculate_diff",
    "DiffResult",
]
```

**Step 6: Commit**

```bash
git add src/codecity/analysis/
git commit -m "feat(analysis): add diff calculator for incremental updates"
```

---

## Phase 3: API Server

### Task 3.1: Create FastAPI App

**Files:**
- Create: `src/codecity/api/__init__.py`
- Create: `src/codecity/api/app.py`
- Create: `src/codecity/api/tests/__init__.py`
- Create: `src/codecity/api/tests/test_app.py`

**Step 1: Write failing test for API**

```python
# src/codecity/api/tests/test_app.py
import pytest
from httpx import ASGITransport, AsyncClient

from codecity.api.app import create_app


@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_city_endpoint_requires_repo_path() -> None:
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/city")
        assert response.status_code == 422  # Missing required param
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/api/tests/test_app.py -v`
Expected: FAIL with import error

**Step 3: Write FastAPI app**

```python
# src/codecity/api/app.py
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from codecity.analysis import (
    FileMetrics,
    calculate_file_metrics,
    generate_city_layout,
    get_file_git_history,
    get_repo_files,
)


def create_app() -> FastAPI:
    app = FastAPI(title="CodeCity API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/city")
    async def get_city(repo_path: str = Query(..., description="Path to git repository")) -> JSONResponse:
        repo = Path(repo_path).resolve()

        if not repo.exists():
            return JSONResponse(
                status_code=404,
                content={"error": f"Repository not found: {repo_path}"},
            )

        files = get_repo_files(repo)
        file_metrics: list[FileMetrics] = []

        for file_path in files:
            full_path = repo / file_path
            if not full_path.is_file():
                continue

            metrics_dict = calculate_file_metrics(full_path)
            history = get_file_git_history(repo, file_path)

            file_metrics.append(
                FileMetrics(
                    path=file_path,
                    lines_of_code=metrics_dict["lines_of_code"],
                    avg_line_length=metrics_dict["avg_line_length"],
                    language=metrics_dict["language"],
                    created_at=history["created_at"],
                    last_modified=history["last_modified"],
                )
            )

        city = generate_city_layout(file_metrics, str(repo))

        return JSONResponse(content=_city_to_dict(city))

    return app


def _city_to_dict(city) -> dict:
    """Convert City dataclass to JSON-serializable dict."""
    def street_to_dict(street) -> dict:
        return {
            "path": street.path,
            "name": street.name,
            "x": street.x,
            "z": street.z,
            "width": street.width,
            "length": street.length,
            "buildings": [
                {
                    "file_path": b.file_path,
                    "height": b.height,
                    "width": b.width,
                    "depth": b.depth,
                    "language": b.language,
                    "created_at": b.created_at.isoformat(),
                    "last_modified": b.last_modified.isoformat(),
                    "x": b.x,
                    "z": b.z,
                }
                for b in street.buildings
            ],
            "substreets": [street_to_dict(s) for s in street.substreets],
        }

    return {
        "repo_path": city.repo_path,
        "generated_at": city.generated_at.isoformat(),
        "root": street_to_dict(city.root),
    }
```

**Step 4: Create package init files**

```python
# src/codecity/api/__init__.py
from codecity.api.app import create_app

__all__ = ["create_app"]
```

```python
# src/codecity/api/tests/__init__.py
```

**Step 5: Run test to verify it passes**

Run: `pytest src/codecity/api/tests/test_app.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add src/codecity/api/
git commit -m "feat(api): add FastAPI app with health and city endpoints"
```

---

### Task 3.2: Create File Watcher

**Files:**
- Create: `src/codecity/api/watcher.py`
- Create: `src/codecity/api/tests/test_watcher.py`

**Step 1: Write failing test for watcher**

```python
# src/codecity/api/tests/test_watcher.py
import asyncio
import tempfile
from pathlib import Path

import pytest

from codecity.api.watcher import FileWatcher, ChangeEvent


@pytest.mark.asyncio
async def test_watcher_detects_file_creation() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        watcher = FileWatcher(Path(tmpdir))
        events: list[ChangeEvent] = []

        async def collect_events():
            async for event in watcher.watch():
                events.append(event)
                break  # Stop after first event

        # Start watcher in background
        task = asyncio.create_task(collect_events())

        # Give watcher time to start
        await asyncio.sleep(0.1)

        # Create a file
        (Path(tmpdir) / "test.py").write_text("# new file")

        # Wait for event or timeout
        try:
            await asyncio.wait_for(task, timeout=2.0)
        except asyncio.TimeoutError:
            task.cancel()

        assert len(events) >= 1


def test_change_event_types() -> None:
    event = ChangeEvent(path="test.py", change_type="modified")
    assert event.path == "test.py"
    assert event.change_type == "modified"
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/api/tests/test_watcher.py -v`
Expected: FAIL with import error

**Step 3: Write watcher implementation**

```python
# src/codecity/api/watcher.py
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncGenerator, Literal

from watchfiles import awatch, Change


ChangeType = Literal["added", "modified", "deleted"]


@dataclass
class ChangeEvent:
    path: str
    change_type: ChangeType


class FileWatcher:
    def __init__(self, repo_path: Path) -> None:
        self.repo_path = repo_path

    async def watch(self) -> AsyncGenerator[ChangeEvent, None]:
        """Watch for file changes and yield events."""
        async for changes in awatch(self.repo_path):
            for change_type, path in changes:
                # Skip .git directory
                if ".git" in path:
                    continue

                relative_path = str(Path(path).relative_to(self.repo_path))

                if change_type == Change.added:
                    yield ChangeEvent(path=relative_path, change_type="added")
                elif change_type == Change.modified:
                    yield ChangeEvent(path=relative_path, change_type="modified")
                elif change_type == Change.deleted:
                    yield ChangeEvent(path=relative_path, change_type="deleted")
```

**Step 4: Run test to verify it passes**

Run: `pytest src/codecity/api/tests/test_watcher.py -v`
Expected: PASS

**Step 5: Update api __init__.py**

```python
# src/codecity/api/__init__.py
from codecity.api.app import create_app
from codecity.api.watcher import ChangeEvent, FileWatcher

__all__ = ["create_app", "FileWatcher", "ChangeEvent"]
```

**Step 6: Commit**

```bash
git add src/codecity/api/
git commit -m "feat(api): add file watcher for live reload"
```

---

### Task 3.3: Create WebSocket Handler

**Files:**
- Create: `src/codecity/api/websocket.py`
- Modify: `src/codecity/api/app.py`
- Create: `src/codecity/api/tests/test_websocket.py`

**Step 1: Write failing test for websocket**

```python
# src/codecity/api/tests/test_websocket.py
import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient

from codecity.api.app import create_app


def test_websocket_endpoint_exists() -> None:
    app = create_app()
    client = TestClient(app)

    # WebSocket connection should be accepted
    with client.websocket_connect("/ws") as websocket:
        # Just verify we can connect
        pass
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/api/tests/test_websocket.py -v`
Expected: FAIL

**Step 3: Write websocket handler**

```python
# src/codecity/api/websocket.py
import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from codecity.api.watcher import ChangeEvent, FileWatcher


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


async def websocket_endpoint(websocket: WebSocket, repo_path: str | None = None) -> None:
    await manager.connect(websocket)

    try:
        if repo_path:
            watcher = FileWatcher(Path(repo_path))

            async def watch_and_broadcast():
                async for event in watcher.watch():
                    await manager.broadcast({
                        "type": "file_change",
                        "path": event.path,
                        "change_type": event.change_type,
                    })

            watch_task = asyncio.create_task(watch_and_broadcast())

            try:
                while True:
                    # Keep connection alive, handle incoming messages
                    data = await websocket.receive_text()
                    # Could handle commands here
            except WebSocketDisconnect:
                watch_task.cancel()
        else:
            # No repo path, just keep connection alive
            while True:
                await websocket.receive_text()

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
```

**Step 4: Update app.py to include websocket**

Add to `src/codecity/api/app.py` after the existing routes:

```python
# Add import at top
from fastapi import WebSocket

# Add websocket route in create_app function
    @app.websocket("/ws")
    async def websocket_route(websocket: WebSocket, repo_path: str | None = None):
        from codecity.api.websocket import websocket_endpoint
        await websocket_endpoint(websocket, repo_path)
```

**Step 5: Run test to verify it passes**

Run: `pytest src/codecity/api/tests/test_websocket.py -v`
Expected: PASS

**Step 6: Update api __init__.py**

```python
# src/codecity/api/__init__.py
from codecity.api.app import create_app
from codecity.api.watcher import ChangeEvent, FileWatcher
from codecity.api.websocket import ConnectionManager

__all__ = ["create_app", "FileWatcher", "ChangeEvent", "ConnectionManager"]
```

**Step 7: Commit**

```bash
git add src/codecity/api/
git commit -m "feat(api): add WebSocket endpoint for live updates"
```

---

## Phase 4: Frontend App

### Task 4.1: Create HTML Shell and Babylon.js Setup

**Files:**
- Create: `src/codecity/app/__init__.py`
- Create: `src/codecity/app/index.html`
- Create: `src/codecity/app/main.js`
- Create: `src/codecity/app/styles.css`

**Step 1: Create app package init**

```python
# src/codecity/app/__init__.py
from pathlib import Path

APP_DIR = Path(__file__).parent

__all__ = ["APP_DIR"]
```

**Step 2: Create HTML file**

```html
<!-- src/codecity/app/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CodeCity</title>
    <link rel="stylesheet" href="styles.css">
    <script src="https://cdn.babylonjs.com/babylon.js"></script>
    <script src="https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js"></script>
</head>
<body>
    <canvas id="renderCanvas"></canvas>
    <div id="inspector" class="inspector hidden">
        <div class="inspector-header">
            <h3 id="inspector-title">File Details</h3>
            <button id="inspector-close">&times;</button>
        </div>
        <div class="inspector-content">
            <div class="inspector-row">
                <span class="label">Path:</span>
                <span id="inspector-path">-</span>
            </div>
            <div class="inspector-row">
                <span class="label">Lines of Code:</span>
                <span id="inspector-loc">-</span>
            </div>
            <div class="inspector-row">
                <span class="label">Avg Line Length:</span>
                <span id="inspector-avg-line">-</span>
            </div>
            <div class="inspector-row">
                <span class="label">Language:</span>
                <span id="inspector-language">-</span>
            </div>
            <div class="inspector-row">
                <span class="label">Created:</span>
                <span id="inspector-created">-</span>
            </div>
            <div class="inspector-row">
                <span class="label">Last Modified:</span>
                <span id="inspector-modified">-</span>
            </div>
            <div class="inspector-actions">
                <button id="btn-open-editor">Open in Editor</button>
                <button id="btn-view-remote">View on GitHub</button>
            </div>
        </div>
    </div>
    <div id="loading" class="loading">
        <div class="spinner"></div>
        <p>Loading city...</p>
    </div>
    <script type="module" src="main.js"></script>
</body>
</html>
```

**Step 3: Create CSS file**

```css
/* src/codecity/app/styles.css */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

#renderCanvas {
    width: 100%;
    height: 100vh;
    display: block;
}

.inspector {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 320px;
    background: rgba(30, 30, 30, 0.95);
    border-radius: 8px;
    color: #fff;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 100;
}

.inspector.hidden {
    display: none;
}

.inspector-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.inspector-header h3 {
    font-size: 14px;
    font-weight: 600;
}

.inspector-header button {
    background: none;
    border: none;
    color: #888;
    font-size: 20px;
    cursor: pointer;
}

.inspector-header button:hover {
    color: #fff;
}

.inspector-content {
    padding: 16px;
}

.inspector-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 13px;
}

.inspector-row .label {
    color: #888;
}

.inspector-actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
}

.inspector-actions button {
    flex: 1;
    padding: 8px 12px;
    border: none;
    border-radius: 4px;
    background: #0066cc;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
}

.inspector-actions button:hover {
    background: #0077ee;
}

.loading {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #1a1a2e;
    color: #fff;
    z-index: 1000;
}

.loading.hidden {
    display: none;
}

.spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: #0066cc;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
```

**Step 4: Create main.js with Babylon.js setup**

```javascript
// src/codecity/app/main.js
import { CityRenderer } from './city-renderer.js';
import { Inspector } from './inspector.js';

class CodeCityApp {
    constructor() {
        this.canvas = document.getElementById('renderCanvas');
        this.loadingEl = document.getElementById('loading');
        this.engine = new BABYLON.Engine(this.canvas, true);
        this.scene = null;
        this.cityRenderer = null;
        this.inspector = new Inspector();
        this.ws = null;

        this.init();
    }

    async init() {
        this.scene = this.createScene();
        this.cityRenderer = new CityRenderer(this.scene, this.inspector);

        // Get repo path from URL params
        const params = new URLSearchParams(window.location.search);
        const repoPath = params.get('repo') || '.';

        try {
            await this.loadCity(repoPath);
            this.connectWebSocket(repoPath);
        } catch (error) {
            console.error('Failed to load city:', error);
        }

        this.hideLoading();

        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }

    createScene() {
        const scene = new BABYLON.Scene(this.engine);
        scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.15, 1);

        // Camera
        const camera = new BABYLON.ArcRotateCamera(
            'camera',
            Math.PI / 4,
            Math.PI / 3,
            200,
            BABYLON.Vector3.Zero(),
            scene
        );
        camera.attachControl(this.canvas, true);
        camera.lowerRadiusLimit = 10;
        camera.upperRadiusLimit = 500;

        // Lights
        const hemiLight = new BABYLON.HemisphericLight(
            'hemiLight',
            new BABYLON.Vector3(0, 1, 0),
            scene
        );
        hemiLight.intensity = 0.6;

        const dirLight = new BABYLON.DirectionalLight(
            'dirLight',
            new BABYLON.Vector3(-1, -2, -1),
            scene
        );
        dirLight.intensity = 0.4;

        // Ground
        const ground = BABYLON.MeshBuilder.CreateGround(
            'ground',
            { width: 1000, height: 1000 },
            scene
        );
        const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.2);
        ground.material = groundMat;

        return scene;
    }

    async loadCity(repoPath) {
        const response = await fetch(`/api/city?repo_path=${encodeURIComponent(repoPath)}`);
        if (!response.ok) {
            throw new Error(`Failed to load city: ${response.statusText}`);
        }
        const cityData = await response.json();
        this.cityRenderer.render(cityData);
    }

    connectWebSocket(repoPath) {
        const wsUrl = `ws://${window.location.host}/ws?repo_path=${encodeURIComponent(repoPath)}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'file_change') {
                this.handleFileChange(data);
            }
        };

        this.ws.onclose = () => {
            // Reconnect after delay
            setTimeout(() => this.connectWebSocket(repoPath), 3000);
        };
    }

    handleFileChange(data) {
        console.log('File changed:', data.path, data.change_type);
        // Reload city data
        const params = new URLSearchParams(window.location.search);
        const repoPath = params.get('repo') || '.';
        this.loadCity(repoPath);
    }

    hideLoading() {
        this.loadingEl.classList.add('hidden');
    }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new CodeCityApp();
});
```

**Step 5: Commit**

```bash
git add src/codecity/app/
git commit -m "feat(app): add HTML shell with Babylon.js scene setup"
```

---

### Task 4.2: Create City Renderer

**Files:**
- Create: `src/codecity/app/city-renderer.js`

**Step 1: Create city renderer**

```javascript
// src/codecity/app/city-renderer.js

// Language hue mapping (matches Python defaults.py)
const LANGUAGE_HUES = {
    python: 210,
    javascript: 50,
    typescript: 200,
    java: 30,
    go: 180,
    rust: 15,
    ruby: 0,
    php: 260,
    c: 220,
    cpp: 220,
    csharp: 270,
    swift: 25,
    kotlin: 280,
    html: 15,
    css: 200,
    json: 45,
    yaml: 120,
    markdown: 150,
    shell: 100,
    unknown: 0,
};

export class CityRenderer {
    constructor(scene, inspector) {
        this.scene = scene;
        this.inspector = inspector;
        this.buildings = new Map(); // file_path -> mesh
        this.streets = [];
    }

    render(cityData) {
        // Clear existing meshes
        this.clear();

        // Render streets and buildings recursively
        this.renderStreet(cityData.root);
    }

    clear() {
        for (const mesh of this.buildings.values()) {
            mesh.dispose();
        }
        this.buildings.clear();

        for (const mesh of this.streets) {
            mesh.dispose();
        }
        this.streets = [];
    }

    renderStreet(street) {
        // Render street as a flat plane
        if (street.width > 0 && street.length > 0) {
            const streetMesh = BABYLON.MeshBuilder.CreateBox(
                `street_${street.path}`,
                {
                    width: street.width,
                    height: 0.1,
                    depth: street.length,
                },
                this.scene
            );
            streetMesh.position.x = street.x + street.width / 2;
            streetMesh.position.y = 0.05;
            streetMesh.position.z = street.z + street.length / 2;

            const streetMat = new BABYLON.StandardMaterial(`streetMat_${street.path}`, this.scene);
            streetMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.25);
            streetMesh.material = streetMat;

            this.streets.push(streetMesh);
        }

        // Render buildings
        for (const building of street.buildings) {
            this.renderBuilding(building);
        }

        // Render sub-streets
        for (const substreet of street.substreets) {
            this.renderStreet(substreet);
        }
    }

    renderBuilding(building) {
        const height = Math.max(building.height / 10, 1); // Scale down, min 1
        const width = Math.max(building.width / 5, 2);    // Scale down, min 2
        const depth = width;

        const mesh = BABYLON.MeshBuilder.CreateBox(
            `building_${building.file_path}`,
            { width, height, depth },
            this.scene
        );

        mesh.position.x = building.x + width / 2;
        mesh.position.y = height / 2;
        mesh.position.z = building.z + depth / 2;

        // Create material with HSL color
        const material = new BABYLON.StandardMaterial(`mat_${building.file_path}`, this.scene);
        const color = this.calculateBuildingColor(building);
        material.diffuseColor = color;
        mesh.material = material;

        // Store building data in mesh metadata
        mesh.metadata = {
            type: 'building',
            data: building,
        };

        // Add click handler
        mesh.actionManager = new BABYLON.ActionManager(this.scene);
        mesh.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnPickTrigger,
                () => this.inspector.show(building)
            )
        );

        this.buildings.set(building.file_path, mesh);
    }

    calculateBuildingColor(building) {
        // Hue from language
        const hue = LANGUAGE_HUES[building.language] || LANGUAGE_HUES.unknown;

        // Saturation from file age (older = more saturated)
        const createdDate = new Date(building.created_at);
        const now = new Date();
        const ageInDays = (now - createdDate) / (1000 * 60 * 60 * 24);
        const saturation = Math.min(0.3 + (ageInDays / 365) * 0.5, 0.8);

        // Lightness from last modified (more recent = lighter)
        const modifiedDate = new Date(building.last_modified);
        const daysSinceModified = (now - modifiedDate) / (1000 * 60 * 60 * 24);
        const lightness = Math.max(0.7 - (daysSinceModified / 180) * 0.3, 0.4);

        // Convert HSL to RGB
        return this.hslToColor3(hue / 360, saturation, lightness);
    }

    hslToColor3(h, s, l) {
        let r, g, b;

        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return new BABYLON.Color3(r, g, b);
    }

    updateBuilding(filePath, newData) {
        const mesh = this.buildings.get(filePath);
        if (mesh) {
            // Update mesh dimensions and color
            mesh.metadata.data = newData;
            const color = this.calculateBuildingColor(newData);
            mesh.material.diffuseColor = color;
        }
    }

    removeBuilding(filePath) {
        const mesh = this.buildings.get(filePath);
        if (mesh) {
            mesh.dispose();
            this.buildings.delete(filePath);
        }
    }
}
```

**Step 2: Commit**

```bash
git add src/codecity/app/city-renderer.js
git commit -m "feat(app): add city renderer with building color calculation"
```

---

### Task 4.3: Create Inspector Panel

**Files:**
- Create: `src/codecity/app/inspector.js`

**Step 1: Create inspector**

```javascript
// src/codecity/app/inspector.js

export class Inspector {
    constructor() {
        this.panel = document.getElementById('inspector');
        this.closeBtn = document.getElementById('inspector-close');
        this.openEditorBtn = document.getElementById('btn-open-editor');
        this.viewRemoteBtn = document.getElementById('btn-view-remote');

        this.currentBuilding = null;
        this.editorUrl = null;
        this.remoteUrl = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.closeBtn.addEventListener('click', () => this.hide());

        this.openEditorBtn.addEventListener('click', () => {
            if (this.editorUrl) {
                window.open(this.editorUrl, '_blank');
            }
        });

        this.viewRemoteBtn.addEventListener('click', () => {
            if (this.remoteUrl) {
                window.open(this.remoteUrl, '_blank');
            }
        });
    }

    show(building) {
        this.currentBuilding = building;

        // Update content
        document.getElementById('inspector-title').textContent = building.file_path.split('/').pop();
        document.getElementById('inspector-path').textContent = building.file_path;
        document.getElementById('inspector-loc').textContent = Math.round(building.height * 10);
        document.getElementById('inspector-avg-line').textContent = (building.width * 5).toFixed(1);
        document.getElementById('inspector-language').textContent = building.language;
        document.getElementById('inspector-created').textContent = this.formatDate(building.created_at);
        document.getElementById('inspector-modified').textContent = this.formatDate(building.last_modified);

        // Get repo path from URL
        const params = new URLSearchParams(window.location.search);
        const repoPath = params.get('repo') || '.';

        // Set editor URL (VS Code by default)
        const fullPath = `${repoPath}/${building.file_path}`;
        this.editorUrl = `vscode://file/${fullPath}:1`;

        // Remote URL would be set from API response
        this.remoteUrl = null;
        this.viewRemoteBtn.style.display = this.remoteUrl ? 'block' : 'none';

        // Show panel
        this.panel.classList.remove('hidden');
    }

    hide() {
        this.panel.classList.add('hidden');
        this.currentBuilding = null;
    }

    formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    }
}
```

**Step 2: Commit**

```bash
git add src/codecity/app/inspector.js
git commit -m "feat(app): add inspector panel for building details"
```

---

### Task 4.4: Create Static Builder

**Files:**
- Create: `src/codecity/app/builder.py`
- Create: `src/codecity/app/tests/__init__.py`
- Create: `src/codecity/app/tests/test_builder.py`

**Step 1: Write failing test for builder**

```python
# src/codecity/app/tests/test_builder.py
import tempfile
from pathlib import Path

from codecity.app.builder import build_static_site


def test_build_creates_output_directory() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert out_dir.exists()


def test_build_copies_html_file() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert (out_dir / "index.html").exists()


def test_build_copies_js_files() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert (out_dir / "main.js").exists()
        assert (out_dir / "city-renderer.js").exists()
        assert (out_dir / "inspector.js").exists()


def test_build_copies_css_file() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert (out_dir / "styles.css").exists()
```

**Step 2: Run test to verify it fails**

Run: `pytest src/codecity/app/tests/test_builder.py -v`
Expected: FAIL with import error

**Step 3: Write builder implementation**

```python
# src/codecity/app/builder.py
import shutil
from pathlib import Path

from codecity.app import APP_DIR


def build_static_site(out_dir: Path) -> None:
    """Build static site by copying frontend assets to output directory."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # Files to copy
    files = [
        "index.html",
        "main.js",
        "city-renderer.js",
        "inspector.js",
        "styles.css",
    ]

    for filename in files:
        src = APP_DIR / filename
        dst = out_dir / filename
        if src.exists():
            shutil.copy2(src, dst)
```

**Step 4: Create test package init**

```python
# src/codecity/app/tests/__init__.py
```

**Step 5: Run test to verify it passes**

Run: `pytest src/codecity/app/tests/test_builder.py -v`
Expected: PASS

**Step 6: Update app __init__.py**

```python
# src/codecity/app/__init__.py
from pathlib import Path

from codecity.app.builder import build_static_site

APP_DIR = Path(__file__).parent

__all__ = ["APP_DIR", "build_static_site"]
```

**Step 7: Commit**

```bash
git add src/codecity/app/
git commit -m "feat(app): add static site builder"
```

---

## Phase 5: CLI Integration

### Task 5.1: Restructure CLI Module

**Files:**
- Create: `src/codecity/cli/__init__.py`
- Create: `src/codecity/cli/commands.py`
- Remove: `src/codecity/cli.py` (old file)
- Modify: `pyproject.toml`

**Step 1: Create CLI package**

```python
# src/codecity/cli/__init__.py
from codecity.cli.commands import cli

__all__ = ["cli"]
```

**Step 2: Create commands.py with serve and build**

```python
# src/codecity/cli/commands.py
import webbrowser
from pathlib import Path
from typing import Any

import rich_click as click
import uvicorn
from rich.console import Console
from rich.table import Table

from codecity.config import Settings

console = Console()

CONTEXT_SETTINGS = dict(help_option_names=["-h", "--help"])
click.rich_click.USE_RICH_MARKUP = True


@click.group(context_settings=CONTEXT_SETTINGS)
@click.pass_context
def cli(ctx: click.Context) -> None:
    """CodeCity - Visualize your codebase as a 3D city."""
    ctx.ensure_object(dict)


@cli.command()
@click.argument(
    "repo_path",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
    default=".",
)
@click.option("--port", "-p", default=3000, help="Port to serve on")
@click.option("--open", "open_browser", is_flag=True, help="Open browser automatically")
@click.option("--debug", is_flag=True, help="Enable debug mode")
@click.option("--config", "config_path", type=click.Path(path_type=Path), help="Config file path")
@click.option("--cache-dir", type=click.Path(path_type=Path), help="Cache directory")
@click.option("--editor", type=str, help="Editor for opening files")
def serve(
    repo_path: Path,
    port: int,
    open_browser: bool,
    debug: bool,
    config_path: Path | None,
    cache_dir: Path | None,
    editor: str | None,
) -> None:
    """Start the CodeCity development server."""
    # Build settings with overrides
    settings_kwargs: dict[str, Any] = {"debug": debug, "port": port, "open_browser": open_browser}
    if config_path:
        settings_kwargs["config_path_override"] = config_path
    if cache_dir:
        settings_kwargs["cache_dir_override"] = cache_dir
    if editor:
        settings_kwargs["editor"] = editor

    settings = Settings(**settings_kwargs)

    # Show config
    _print_config(repo_path, settings)

    # Import app here to avoid circular imports
    from codecity.api import create_app

    app = create_app()

    # Store repo path for API to access
    app.state.repo_path = repo_path.resolve()
    app.state.settings = settings

    console.print(f"\n[green]Starting CodeCity server at http://localhost:{port}[/green]")
    console.print(f"[dim]Visualizing: {repo_path.resolve()}[/dim]\n")

    if open_browser:
        webbrowser.open(f"http://localhost:{port}?repo={repo_path.resolve()}")

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


@cli.command()
@click.argument(
    "repo_path",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
    default=".",
)
@click.option("--out-dir", "-o", type=click.Path(path_type=Path), default="./codecity-dist", help="Output directory")
@click.option("--debug", is_flag=True, help="Enable debug mode")
@click.option("--config", "config_path", type=click.Path(path_type=Path), help="Config file path")
@click.option("--cache-dir", type=click.Path(path_type=Path), help="Cache directory")
def build(
    repo_path: Path,
    out_dir: Path,
    debug: bool,
    config_path: Path | None,
    cache_dir: Path | None,
) -> None:
    """Build static CodeCity visualization."""
    # Build settings with overrides
    settings_kwargs: dict[str, Any] = {"debug": debug, "out_dir": out_dir}
    if config_path:
        settings_kwargs["config_path_override"] = config_path
    if cache_dir:
        settings_kwargs["cache_dir_override"] = cache_dir

    settings = Settings(**settings_kwargs)

    # Show config
    _print_config(repo_path, settings)

    from codecity.app import build_static_site

    console.print(f"\n[yellow]Building static site...[/yellow]")
    build_static_site(out_dir)
    console.print(f"[green]Built to: {out_dir.resolve()}[/green]\n")


@cli.group()
def config() -> None:
    """Manage CodeCity configuration."""
    pass


@config.command("get")
@click.argument("key")
def config_get(key: str) -> None:
    """Get a configuration value."""
    settings = Settings()
    try:
        value = getattr(settings, key)
        console.print(f"{key} = {value}")
    except AttributeError:
        console.print(f"[red]Unknown config key: {key}[/red]")


@config.command("list")
def config_list() -> None:
    """List all configuration values."""
    settings = Settings()
    table = Table(title="Configuration")
    table.add_column("Key")
    table.add_column("Value")

    for key in ["editor", "port", "debug", "cache_dir", "config_path", "out_dir"]:
        value = getattr(settings, key)
        table.add_row(key, str(value))

    console.print(table)


@config.command("path")
def config_path() -> None:
    """Show the configuration file path."""
    settings = Settings()
    console.print(f"Config path: {settings.config_path}")


def _print_config(repo_path: Path, settings: Settings) -> None:
    """Print configuration table."""
    table = Table(title="CodeCity Configuration", title_justify="left")
    table.add_column("Setting")
    table.add_column("Value")

    table.add_row("Repo Path", str(repo_path.resolve()))
    table.add_row("Cache Dir", str(settings.cache_dir))
    table.add_row("Editor", settings.editor)

    if settings.debug:
        table.add_row("Debug", "[green]Enabled[/green]")

    console.print(table)
```

**Step 3: Update pyproject.toml entry point**

Change the scripts section:

```toml
[project.scripts]
codecity = "codecity.cli:cli"
```

**Step 4: Create CLI tests**

```python
# src/codecity/cli/tests/__init__.py
```

```python
# src/codecity/cli/tests/test_commands.py
from click.testing import CliRunner

from codecity.cli import cli


def test_cli_help() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "CodeCity" in result.output


def test_serve_help() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["serve", "--help"])
    assert result.exit_code == 0
    assert "--port" in result.output


def test_build_help() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["build", "--help"])
    assert result.exit_code == 0
    assert "--out-dir" in result.output


def test_config_list() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["config", "list"])
    assert result.exit_code == 0
    assert "editor" in result.output
```

**Step 5: Run tests**

Run: `pytest src/codecity/cli/tests/test_commands.py -v`
Expected: PASS

**Step 6: Remove old cli.py and commit**

```bash
rm src/codecity/cli.py
git add -A
git commit -m "feat(cli): restructure CLI with serve, build, and config commands"
```

---

### Task 5.2: Add Static File Serving to API

**Files:**
- Modify: `src/codecity/api/app.py`

**Step 1: Update app.py to serve static files**

Add static file mounting to `create_app()`:

```python
# Add imports at top
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from codecity.app import APP_DIR

# Add in create_app() after other routes:
    @app.get("/")
    async def index():
        return FileResponse(APP_DIR / "index.html")

    # Mount static files
    app.mount("/", StaticFiles(directory=APP_DIR), name="static")
```

**Step 2: Run full test suite**

Run: `pytest src/ -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/codecity/api/app.py
git commit -m "feat(api): add static file serving for frontend"
```

---

## Phase 6: Final Integration

### Task 6.1: Clean Up and Final Tests

**Files:**
- Remove: `src/codecity/client/` (old folder, replaced by config)
- Update: `src/codecity/__init__.py`

**Step 1: Remove old client folder**

```bash
rm -rf src/codecity/client/
```

**Step 2: Update main package init**

```python
# src/codecity/__init__.py
from codecity.analysis import (
    Building,
    City,
    FileMetrics,
    Street,
)
from codecity.config import Settings

__all__ = [
    "Settings",
    "FileMetrics",
    "Building",
    "Street",
    "City",
]
```

**Step 3: Run full test suite**

Run: `pytest src/ -v`
Expected: All tests PASS

**Step 4: Test CLI manually**

Run: `codecity --help`
Expected: Shows help with serve, build, config commands

Run: `codecity serve . --port 3001` (in a git repo)
Expected: Server starts, opens browser with 3D city

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: clean up old code and finalize package structure"
```

---

## Summary

This plan implements CodeCity in 6 phases:

1. **Foundation** - Dependencies, Settings, Defaults
2. **Analysis Engine** - Models, Metrics, Git, Cache, Layout, Diff
3. **API Server** - FastAPI, Watcher, WebSocket
4. **Frontend App** - Babylon.js, City Renderer, Inspector, Builder
5. **CLI Integration** - Serve, Build, Config commands
6. **Final Integration** - Cleanup and testing

Each task follows TDD: write failing test, implement, verify, commit.

---

**Plan complete and saved to `docs/plans/2026-01-17-codecity-implementation-plan.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
