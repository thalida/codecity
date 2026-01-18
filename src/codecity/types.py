from pathlib import Path
from typing import Annotated

from pydantic import AfterValidator


def is_git_repo(path: Path) -> Path:
    has_git_dir = (path / ".git").is_dir()

    if not has_git_dir:
        raise ValueError(f"The path '{path}' is not a valid Git repository.")

    return path


GIT_REPO_PATH = Annotated[Path, AfterValidator(is_git_repo)]
