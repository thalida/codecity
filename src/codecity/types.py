from typing import Any, Protocol

import rich_click as click

from codecity.client import CodeCityClient


class CliCommandFunc(Protocol):
    def __call__(
        self,
        ctx: click.Context,
        client: CodeCityClient,
        **kwargs: Any,
    ) -> None: ...
