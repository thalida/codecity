import functools
from typing import Any

import rich_click as click
from rich.console import Console
from rich.table import Table

from codecity.client import CodeCityClient
from codecity.types import CliCommandFunc

console = Console()
default_client = CodeCityClient()

CONTEXT_SETTINGS = dict(help_option_names=["-h", "--help"])
click.rich_click.USE_RICH_MARKUP = True


@click.group(context_settings=CONTEXT_SETTINGS)
@click.pass_context
def cli(ctx: click.Context):
    ctx.ensure_object(dict)
    return ctx


def cli_command(func: CliCommandFunc):
    @cli.command(
        epilog="""
        [bold underline white]Resources[/]\n
        \n
        [link=https://github.com]User Guides[/] \n
        [link=https://github.com]Developer Documentation[/] \n
        """,
    )
    @click.pass_context
    @click.argument(
        "project_path",
        type=click.Path(exists=True, readable=True, file_okay=False, dir_okay=True),
        default=".",
    )
    @click.option(
        "--debug/--no-debug",
        "debug",
        default=False,
        show_default=True,
        help="Enable debug mode",
    )
    @functools.wraps(func)
    def wrapper(ctx: click.Context, **kwargs: dict[str, str | bool | click.Path]):
        client = CodeCityClient(
            project_path=kwargs.pop("project_path"),
            debug=kwargs.pop("debug"),
        )

        table = Table(
            title="Settings",
            title_justify="left",
            title_style="bold",
            show_lines=False,
            show_edge=True,
            show_header=False,
            expand=True,
            pad_edge=True,
        )
        table.add_column("Setting")
        table.add_column("Value")

        if True:
            table.add_row(
                "Debug", "[green]Enabled" if client.debug else "[red]Disabled"
            )

        console.print(table)
        click.echo()

        # with yaspin(text="Logging into AO3\r", color="yellow") as spinner:
        #     try:
        #         api.auth.login(username=username, password=password)
        #         spinner.color = "green"
        #         spinner.text = "Successfully logged in!"
        #         spinner.ok("✔")
        #     except Exception as e:
        #         is_ao3_exception = isinstance(e, ao3_sync.api.exceptions.AO3Exception)
        #         spinner.color = "red"
        #         spinner.text = e.args[0] if is_ao3_exception else "An error occurred while logging in"
        #         spinner.fail("✘")
        #         api._debug_log(e)
        #         return

        return func(ctx, client, **kwargs)

    return wrapper


@cli_command
def serve(
    ctx: click.Context,
    client: CodeCityClient,
    **kwargs: Any,
) -> None:
    click.secho("\nServe CodeCity", bold=True, color=True)
    click.secho(f"Project path: {client.project_path}", bold=True, color=True)


@cli_command
def build(
    ctx: click.Context,
    client: CodeCityClient,
    **kwargs: Any,
) -> None:
    click.secho("\nBuild CodeCity", bold=True, color=True)
    click.secho(f"Project path: {client.project_path}", bold=True, color=True)


if __name__ == "__main__":
    cli()
