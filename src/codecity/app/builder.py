# src/codecity/app/builder.py
import shutil
from pathlib import Path

# Define APP_DIR locally to avoid circular import with __init__.py
_APP_DIR = Path(__file__).parent


def build_static_site(out_dir: Path) -> None:
    """Build static site by copying frontend assets to output directory."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # Files to copy
    files = [
        "index.html",
        "main.js",
        "city-renderer.js",
        "inspector.js",
        "styles.css",
    ]

    for filename in files:
        src = _APP_DIR / filename
        dst = out_dir / filename
        if src.exists():
            shutil.copy2(src, dst)
