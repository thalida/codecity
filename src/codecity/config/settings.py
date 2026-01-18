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
