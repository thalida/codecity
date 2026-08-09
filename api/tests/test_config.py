"""Tests for api.config — the typed CODECITY_* settings and the live reads."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest import mock

from pydantic import ValidationError

from api.config import (
    DISCOVER_FILE,
    Settings,
    discover_enabled,
    discover_file,
    hosted,
    local_repos_allowed,
    quiet,
    settings,
    MAX_FILE_BYTES,
    GZIP_MIN_BYTES,
)


class SettingsTests(unittest.TestCase):
    def test_booleans_accept_the_usual_spellings(self) -> None:
        for v in ("1", "true", "TRUE", "True", "yes", "on", " on ", "YES"):
            with mock.patch.dict(os.environ, {"CODECITY_HOSTED": v}):
                self.assertTrue(hosted(), v)
        for v in ("0", "false", "no", "off", "OFF", " off "):
            with mock.patch.dict(os.environ, {"CODECITY_HOSTED": v}):
                self.assertFalse(hosted(), v)

    def test_a_bogus_boolean_raises_rather_than_defaulting(self) -> None:
        """A parser that reads anything unrecognized as false would let
        CODECITY_DISCOVER=enabled silently empty the Discover tab. It fails at
        the first read instead."""
        with mock.patch.dict(os.environ, {"CODECITY_DISCOVER": "enabled"}):
            with self.assertRaises(ValidationError):
                discover_enabled()

    def test_defaults_when_nothing_is_set(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(local_repos_allowed())
            self.assertFalse(hosted())
            self.assertFalse(quiet())
            self.assertTrue(discover_enabled())
            self.assertEqual(discover_file(), DISCOVER_FILE)

    def test_reads_are_live(self) -> None:
        """Accessors re-read per call so a monkeypatched env takes effect
        without a restart."""
        with mock.patch.dict(os.environ, {"CODECITY_ALLOW_LOCAL_REPOS": "1"}):
            self.assertTrue(local_repos_allowed())
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(local_repos_allowed())

    def test_discover_file_override(self) -> None:
        with mock.patch.dict(os.environ, {"CODECITY_DISCOVER_FILE": "/tmp/d.json"}):
            self.assertEqual(discover_file(), Path("/tmp/d.json"))

    def test_unknown_codecity_vars_are_ignored(self) -> None:
        """An operator's stray var must not crash the process on boot."""
        with mock.patch.dict(os.environ, {"CODECITY_NOT_A_SETTING": "x"}):
            self.assertIsInstance(settings(), Settings)

    def test_settings_does_not_read_a_dotenv_file(self) -> None:
        """The api reads the environment and nothing else, so a developer's
        .env.local can never leak into a test run."""
        self.assertIsNone(Settings.model_config.get("env_file"))

    def test_size_constants(self) -> None:
        self.assertEqual(MAX_FILE_BYTES, 100 * 1024 * 1024)
        self.assertEqual(GZIP_MIN_BYTES, 256)
