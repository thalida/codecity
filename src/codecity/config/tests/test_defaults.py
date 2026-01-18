import pytest

from codecity.config.defaults import (
    LANGUAGE_COLORS,
    get_editor_url,
    get_language_from_extension,
    get_language_hue,
)


def test_get_editor_url_vscode() -> None:
    url = get_editor_url("vscode", "/path/to/file.py", 42)
    assert url == "vscode://file//path/to/file.py:42"


def test_get_editor_url_cursor() -> None:
    url = get_editor_url("cursor", "/path/to/file.py", 10)
    assert url == "cursor://file//path/to/file.py:10"


def test_get_editor_url_custom() -> None:
    url = get_editor_url("custom", "/path/to/file.py", 5, "nvim +{line} {file}")
    assert url == "nvim +5 /path/to/file.py"


def test_get_editor_url_custom_missing_command() -> None:
    with pytest.raises(ValueError, match="custom_command is required"):
        get_editor_url("custom", "/path/to/file.py", 5)


def test_language_colors_has_common_languages() -> None:
    assert "python" in LANGUAGE_COLORS
    assert "javascript" in LANGUAGE_COLORS
    assert "typescript" in LANGUAGE_COLORS


# Tests for get_language_from_extension
def test_get_language_from_extension_known() -> None:
    assert get_language_from_extension(".py") == "python"


def test_get_language_from_extension_unknown() -> None:
    assert get_language_from_extension(".xyz") == "unknown"


def test_get_language_from_extension_case_insensitive() -> None:
    assert get_language_from_extension(".PY") == "python"


# Tests for get_language_hue
def test_get_language_hue_known() -> None:
    assert get_language_hue("python") == 210


def test_get_language_hue_unknown() -> None:
    assert get_language_hue("unknownlanguage") == 0


def test_get_language_hue_case_insensitive() -> None:
    assert get_language_hue("PYTHON") == 210
