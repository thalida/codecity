"""Tests for the permissive boolean env-var parser in api._env."""

from __future__ import annotations

import unittest

import pytest

from api._env import env_bool


class EnvBoolTests(unittest.TestCase):
    """Truthy values: '1', 'true', 'yes', 'on' (case-insensitive,
    whitespace-trimmed). Anything else (including unset) is False."""

    NAME = "CODECITY_TEST_ENV_BOOL"

    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.monkeypatch = monkeypatch
        # Start from a clean slate every test.
        monkeypatch.delenv(self.NAME, raising=False)

    def _set(self, value: str) -> None:
        self.monkeypatch.setenv(self.NAME, value)

    # Truthy values
    def test_one_enables(self) -> None:
        self._set("1")
        self.assertTrue(env_bool(self.NAME))

    def test_true_enables(self) -> None:
        self._set("true")
        self.assertTrue(env_bool(self.NAME))

    def test_uppercase_true_enables(self) -> None:
        self._set("TRUE")
        self.assertTrue(env_bool(self.NAME))

    def test_mixed_case_true_enables(self) -> None:
        self._set("True")
        self.assertTrue(env_bool(self.NAME))

    def test_yes_enables(self) -> None:
        self._set("yes")
        self.assertTrue(env_bool(self.NAME))

    def test_on_enables(self) -> None:
        self._set("on")
        self.assertTrue(env_bool(self.NAME))

    def test_whitespace_is_trimmed(self) -> None:
        self._set("  true  ")
        self.assertTrue(env_bool(self.NAME))

    # Falsy values
    def test_zero_disables(self) -> None:
        self._set("0")
        self.assertFalse(env_bool(self.NAME))

    def test_false_disables(self) -> None:
        self._set("false")
        self.assertFalse(env_bool(self.NAME))

    def test_no_disables(self) -> None:
        self._set("no")
        self.assertFalse(env_bool(self.NAME))

    def test_off_disables(self) -> None:
        self._set("off")
        self.assertFalse(env_bool(self.NAME))

    def test_empty_string_disables(self) -> None:
        self._set("")
        self.assertFalse(env_bool(self.NAME))

    def test_arbitrary_string_disables(self) -> None:
        self._set("maybe")
        self.assertFalse(env_bool(self.NAME))

    # Unset
    def test_unset_returns_default_false(self) -> None:
        # No setenv — env var is absent.
        self.assertFalse(env_bool(self.NAME))

    def test_unset_returns_supplied_default(self) -> None:
        self.assertTrue(env_bool(self.NAME, default=True))


if __name__ == "__main__":
    unittest.main()
