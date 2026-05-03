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
) -> None:
    """Open a chrome-less window pointing at ``url`` and block until closed.

    ``debug=True`` enables WebKit/Chromium developer extras — right-click
    inside the window to get Inspect Element + the JS console.
    """
    webview.create_window(title, url, width=width, height=height)
    webview.start(debug=debug)
