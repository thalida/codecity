from codecity.config import Settings


def test_settings_default_values() -> None:
    settings = Settings()
    assert settings.editor == "vscode"
    assert settings.port == 3000
    assert settings.debug is False


def test_settings_cache_dir_uses_platformdirs() -> None:
    settings = Settings()
    # Should be in user cache dir, not current directory
    assert "codecity" in str(settings.cache_dir).lower()


def test_settings_config_path_uses_platformdirs() -> None:
    settings = Settings()
    assert "codecity" in str(settings.config_path).lower()
