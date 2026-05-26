"""Dev-only: watch api/**/*.py and re-exec the process on change.

Used by `python -m api --reload` (i.e. docker-compose.dev.yml's api command).
Not imported in prod — keeps watchfiles out of the runtime hot path.

Implementation: re-exec via os.execv. Simpler than child-process supervision
and Compose's `init: true` ensures we get a clean shutdown on SIGTERM. The
api/scan.py and api/server.py state is fully recreated on re-exec.
"""

from __future__ import annotations

import os
import signal
import sys
from pathlib import Path
from threading import Event, Thread

WATCH_ROOT = Path(__file__).resolve().parent


def _is_python_source(path: Path) -> bool:
    """True if `path` is a .py file under WATCH_ROOT, excluding __pycache__."""
    if path.suffix != ".py":
        return False
    if "__pycache__" in path.parts:
        return False
    try:
        path.resolve().relative_to(WATCH_ROOT)
    except ValueError:
        return False
    return True


def run_with_reload(port: int) -> int:
    """Run the server with auto-reload on api/**/*.py changes.

    Returns the server's exit code. Re-execs on first detected change instead
    of returning — execv replaces the process image, so the function never
    returns in that path.
    """
    from watchfiles import watch

    from api.server import start_server

    _, bound, shutdown = start_server(port=port, host="0.0.0.0")
    print(
        f"[codecity] listening on http://0.0.0.0:{bound}/ (reload enabled)",
        file=sys.stderr,
        flush=True,
    )

    # One Event drives both the watcher thread (stops the watch() loop) and
    # the main thread (wakes from wait() on SIGTERM/SIGINT). The watcher
    # never sets it — execv replaces the process before that matters — but
    # the main signal handler does.
    shutdown_event = Event()

    def _watcher() -> None:
        for changes in watch(str(WATCH_ROOT), stop_event=shutdown_event):
            relevant = [path for _change, path in changes if _is_python_source(Path(path))]
            if not relevant:
                continue
            for p in relevant:
                print(f"[codecity] reload triggered by {p}", file=sys.stderr, flush=True)
            # Shut down the server cleanly, then re-exec ourselves with the
            # same argv. execv replaces the process — no return.
            try:
                shutdown()
            except Exception as e:  # pylint: disable=broad-except
                print(
                    f"[codecity] shutdown error before reload: {e}",
                    file=sys.stderr,
                    flush=True,
                )
            # Re-exec with `python -m api <original-flags>`. sys.argv[1:] preserves
            # --port and --reload because argparse doesn't consume args destructively.
            # Revisit if we add subcommands or env-driven config that argparse mutates.
            os.execv(sys.executable, [sys.executable, "-m", "api", *sys.argv[1:]])

    Thread(target=_watcher, daemon=True, name="cc-reload-watcher").start()

    def _handle(signum: int, _frame: object) -> None:
        shutdown_event.set()

    signal.signal(signal.SIGINT, _handle)
    signal.signal(signal.SIGTERM, _handle)

    try:
        shutdown_event.wait()
    finally:
        shutdown()
    return 0
