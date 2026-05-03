"""PyWebView window launcher.

PyWebView's main loop must run on the main thread on macOS, so this
function is a thin wrapper that the CLI calls last (after the HTTP
server is already serving on a background thread).
"""

from __future__ import annotations

import webview


def launch(url: str, title: str = "CodeCity", width: int = 1400, height: int = 900) -> None:
    """Open a chrome-less window pointing at ``url`` and block until closed."""
    webview.create_window(title, url, width=width, height=height)
    webview.start()
