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
@click.option(
    "--config", "config_path", type=click.Path(path_type=Path), help="Config file path"
)
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
    settings_kwargs: dict[str, Any] = {
        "debug": debug,
        "port": port,
        "open_browser": open_browser,
    }
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

    console.print(
        f"\n[green]Starting CodeCity server at http://localhost:{port}[/green]"
    )
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
@click.option(
    "--out-dir",
    "-o",
    type=click.Path(path_type=Path),
    default="./codecity-dist",
    help="Output directory",
)
@click.option("--debug", is_flag=True, help="Enable debug mode")
@click.option(
    "--config", "config_path", type=click.Path(path_type=Path), help="Config file path"
)
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

    console.print("\n[yellow]Building static site...[/yellow]")
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
