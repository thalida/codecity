"""PyWebView window launcher.

PyWebView's main loop must run on the main thread on macOS, so this
function is a thin wrapper that the CLI calls last (after the HTTP
server is already serving on a background thread).
"""

from __future__ import annotations

import webview


def launch(
    url: str,
    title: str = "CodeCity",
    width: int = 1400,
    height: int = 900,
    debug: bool = False,
    on_closed=None,
) -> None:
    """Open a chrome-less window pointing at ``url`` and block until closed.

    The window opens maximized — codecity is a viewer, the more screen
    real estate the better. ``width`` and ``height`` are the fallback
    dimensions if the platform can't honour ``maximized``.

    ``debug=True`` enables WebKit/Chromium developer extras — right-click
    inside the window to get Inspect Element + the JS console.

    ``on_closed`` runs on the pywebview ``closed`` event, which fires
    before macOS Cocoa terminates the process. This is the only reliable
    place to do cleanup that needs to happen on window-close — Python's
    atexit / try-finally blocks get skipped on macOS because pywebview
    exits via NSApplication.terminate(), not a normal return.
    """
    window = webview.create_window(
        title, url,
        width=width, height=height,
        maximized=True,
        text_select=True,
    )
    if on_closed is not None and window is not None:
        window.events.closed += on_closed
    webview.start(debug=debug)
