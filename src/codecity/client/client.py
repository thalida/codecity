from pathlib import Path
from typing import Any

from loguru import logger
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console

from codecity.types import GIT_REPO_PATH

console = Console()


class CodeCityClient(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="CODECITY_",
        env_ignore_empty=True,
        case_sensitive=False,
        extra="ignore",
    )

    repo_path: GIT_REPO_PATH = Path.cwd()
    debug: bool = False

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)

        # self._http_client = AO3LimiterSession(burst=1, per_second=1 / self.requests_delay_seconds)
        # self._http_client.headers.update(
        #     {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0"}
        # )

        # # Resources
        # self._auth: Optional["AuthApi"] = None
        # self._bookmarks: Optional["BookmarksApi"] = None
        # self._series: Optional["SeriesApi"] = None
        # self._works: Optional["WorksApi"] = None

    # @property
    # def auth(self):
    #     """
    #     Auth Api Instance

    #     Returns:
    #         (AuthApi): AuthApi Instance
    #     """

    #     if self._auth is None:
    #         from ao3_sync.api.resources.auth import AuthApi

    #         self._auth = AuthApi(self)

    #     return self._auth

    # @property
    # def bookmarks(self):
    #     """
    #     Bookmarks Api Instance

    #     Returns:
    #         (BookmarksApi): BookmarksApi Instance
    #     """

    #     if self._bookmarks is None:
    #         from ao3_sync.api.resources.bookmarks import BookmarksApi

    #         self._bookmarks = BookmarksApi(self)

    #     return self._bookmarks

    # @property
    # def series(self):
    #     """
    #     Series Api Instance

    #     Returns:
    #         (SeriesApi): SeriesApi Instance
    #     """

    #     if self._series is None:
    #         from ao3_sync.api.resources.series import SeriesApi

    #         self._series = SeriesApi(self)

    #     return self._series

    # @property
    # def works(self):
    #     """
    #     Works Api Instance

    #     Returns:
    #         (WorksApi): WorksApi Instance
    #     """

    #     if self._works is None:
    #         from ao3_sync.api.resources.works import WorksApi

    #         self._works = WorksApi(self)

    #     return self._works

    def _log(self, *args: Any, **kwargs: Any) -> None:
        """
        Generic user-facing log function
        """
        console.print(*args, **kwargs)

    def _debug_log(self, *args: Any, **kwargs: Any) -> None:
        """
        Debug Mode Only: Basic log
        """
        if not self.debug:
            return

        logger.opt(depth=1).debug(*args, **kwargs)

    def _debug_error(self, *args: Any, **kwargs: Any) -> None:
        """
        Debug Mode Only: Error log
        """
        if not self.debug:
            return

        logger.opt(depth=1).error(*args, **kwargs)

    def _debug_info(self, *args: Any, **kwargs: Any) -> None:
        """
        Debug Mode Only: Info log
        """
        if not self.debug:
            return

        logger.opt(depth=1).info(*args, **kwargs)
