"""Tests for api.config — env-driven settings + the live-read helpers."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from pathlib import Path

from api.config import (
    DISCOVER_FILE,
    discover_enabled,
    discover_file,
    env_bool,
    hosted,
    local_repos_allowed,
    quiet,
    MAX_FILE_BYTES,
    GZIP_MIN_BYTES,
)


class ConfigTests(unittest.TestCase):
    def test_env_bool_truthy_values(self) -> None:
        for v in ("1", "true", "TRUE", "True", "yes", "on", " on ", "YES"):
            with mock.patch.dict(os.environ, {"X": v}):
                self.assertTrue(env_bool("X"), v)

    def test_env_bool_falsey_values(self) -> None:
        for v in ("0", "false", "no", "off", "", "nope"):
            with mock.patch.dict(os.environ, {"X": v}):
                self.assertFalse(env_bool("X"), v)

    def test_env_bool_absent_uses_default(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(env_bool("X"))
            self.assertTrue(env_bool("X", default=True))

    def test_local_repos_allowed_reads_live(self) -> None:
        with mock.patch.dict(os.environ, {"CODECITY_ALLOW_LOCAL_REPOS": "1"}):
            self.assertTrue(local_repos_allowed())
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(local_repos_allowed())

    def test_quiet_reads_live(self) -> None:
        with mock.patch.dict(os.environ, {"CODECITY_QUIET": "1"}):
            self.assertTrue(quiet())
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(quiet())

    def test_hosted_reads_live(self) -> None:
        with mock.patch.dict(os.environ, {"CODECITY_HOSTED": "1"}):
            self.assertTrue(hosted())
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(hosted())

    def test_discover_is_on_unless_explicitly_off(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertTrue(discover_enabled())
        for v in ("off", "OFF", " off ", "0", "false", "no"):
            with mock.patch.dict(os.environ, {"CODECITY_DISCOVER": v}):
                self.assertFalse(discover_enabled(), v)
        for v in ("1", "on", "yes", "enabled"):
            with mock.patch.dict(os.environ, {"CODECITY_DISCOVER": v}):
                self.assertTrue(discover_enabled(), v)

    def test_discover_file_defaults_to_the_bundled_list(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(discover_file(), DISCOVER_FILE)
        with mock.patch.dict(os.environ, {"CODECITY_DISCOVER_FILE": "/tmp/d.json"}):
            self.assertEqual(discover_file(), Path("/tmp/d.json"))

    def test_size_constants(self) -> None:
        self.assertEqual(MAX_FILE_BYTES, 100 * 1024 * 1024)
        self.assertEqual(GZIP_MIN_BYTES, 256)
