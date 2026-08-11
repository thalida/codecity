"""min_iso / max_iso: earliest/latest ISO string, tolerating None."""

from __future__ import annotations

import unittest

from api.date_utils import max_iso, min_iso


class DateUtilTests(unittest.TestCase):
    def test_min_iso_picks_earliest(self) -> None:
        self.assertEqual(min_iso("2024-03-01", "2026-06-01"), "2024-03-01")
        self.assertEqual(min_iso("2026-06-01", "2024-03-01"), "2024-03-01")

    def test_max_iso_picks_latest(self) -> None:
        self.assertEqual(max_iso("2024-03-01", "2026-06-01"), "2026-06-01")
        self.assertEqual(max_iso("2026-06-01", "2024-03-01"), "2026-06-01")

    def test_none_operands_are_ignored(self) -> None:
        self.assertEqual(min_iso(None, "2024-03-01"), "2024-03-01")
        self.assertEqual(min_iso("2024-03-01", None), "2024-03-01")
        self.assertEqual(max_iso(None, "2026-06-01"), "2026-06-01")
        self.assertEqual(max_iso("2026-06-01", None), "2026-06-01")

    def test_both_none_returns_none(self) -> None:
        self.assertIsNone(min_iso(None, None))
        self.assertIsNone(max_iso(None, None))


if __name__ == "__main__":
    unittest.main()
