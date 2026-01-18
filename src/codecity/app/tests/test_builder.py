# src/codecity/app/tests/test_builder.py
import tempfile
from pathlib import Path

from codecity.app.builder import build_static_site


def test_build_creates_output_directory() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert out_dir.exists()


def test_build_copies_html_file() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert (out_dir / "index.html").exists()


def test_build_copies_js_files() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert (out_dir / "main.js").exists()
        assert (out_dir / "city-map.js").exists()


def test_build_copies_css_file() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        out_dir = Path(tmpdir) / "dist"
        build_static_site(out_dir)
        assert (out_dir / "styles.css").exists()
