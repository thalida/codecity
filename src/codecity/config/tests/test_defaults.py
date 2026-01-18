from codecity.config.defaults import LANGUAGE_COLORS, get_editor_url


def test_get_editor_url_vscode() -> None:
    url = get_editor_url("vscode", "/path/to/file.py", 42)
    assert url == "vscode://file//path/to/file.py:42"


def test_get_editor_url_cursor() -> None:
    url = get_editor_url("cursor", "/path/to/file.py", 10)
    assert url == "cursor://file//path/to/file.py:10"


def test_get_editor_url_custom() -> None:
    url = get_editor_url("custom", "/path/to/file.py", 5, "nvim +{line} {file}")
    assert url == "nvim +5 /path/to/file.py"


def test_language_colors_has_common_languages() -> None:
    assert "python" in LANGUAGE_COLORS
    assert "javascript" in LANGUAGE_COLORS
    assert "typescript" in LANGUAGE_COLORS
