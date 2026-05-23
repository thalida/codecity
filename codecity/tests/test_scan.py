"""Unit tests for codecity/scan.py."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codecity.scan import (
    _extension,
    _is_binary,
    compute_tree_signature,
    scan_tree,
    signature_tree,
)


# Silence progress logs during tests.
os.environ["CODECITY_QUIET"] = "1"

# Tests use a wide history window so the fixture's hardcoded commit
# dates (oldest is 2024-01-10) never fall outside the rolling cutoff
# as wall-clock time advances. The default in production is
# "3.years.ago"; for tests we want everything in scope.
os.environ.setdefault("CODECITY_GIT_WINDOW", "30.years.ago")

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURE = FIXTURES_DIR / "sample-repo"


def _ensure_fixture() -> None:
    """Make sure fixtures/setup.sh has been run."""
    if not (FIXTURE / ".git").is_dir():
        subprocess.check_call(["bash", str(FIXTURES_DIR / "setup.sh")])


class _CacheRedirectMixin:
    """Mixin that redirects codecity.cache.CACHE_ROOT to a per-test
    tempdir so calls to scan_tree() / signature_tree() / etc. don't
    pollute the user's actual ~/.cache/codecity/ during tests."""

    def setUp(self) -> None:
        super().setUp()  # cooperative chaining for subclasses with their own setUp
        from codecity import cache as cache_mod
        self._cache_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._cache_tmp.cleanup)
        self._original_cache_root = cache_mod.CACHE_ROOT
        cache_mod.CACHE_ROOT = Path(self._cache_tmp.name)
        self.addCleanup(self._restore_cache_root)

    def _restore_cache_root(self) -> None:
        from codecity import cache as cache_mod
        cache_mod.CACHE_ROOT = self._original_cache_root


class ExtensionTests(unittest.TestCase):
    def test_plain_file(self):
        self.assertEqual(_extension("index.ts"), ".ts")

    def test_multiple_dots(self):
        self.assertEqual(_extension("index.test.ts"), ".ts")

    def test_dotfile_without_second_dot(self):
        # .gitignore has no extension in the scanner's view.
        self.assertEqual(_extension(".gitignore"), "")
        self.assertEqual(_extension(".env"), "")

    def test_dotfile_with_second_dot(self):
        self.assertEqual(_extension(".env.local"), ".local")

    def test_no_dot_at_all(self):
        self.assertEqual(_extension("Makefile"), "")


class BinaryDetectionTests(unittest.TestCase):
    def _tmp_file(self, content: bytes) -> Path:
        fd, name = tempfile.mkstemp()
        os.close(fd)
        p = Path(name)
        p.write_bytes(content)
        self.addCleanup(p.unlink, missing_ok=True)
        return p

    def test_text_file_is_text(self):
        p = self._tmp_file(b"hello world\nline two\n")
        self.assertFalse(_is_binary(p))

    def test_file_with_null_bytes_is_binary(self):
        p = self._tmp_file(b"hello\x00world")
        self.assertTrue(_is_binary(p))

    def test_empty_file_is_text(self):
        p = self._tmp_file(b"")
        self.assertFalse(_is_binary(p))

    def test_mostly_control_chars_is_binary(self):
        # 200 random control bytes (outside the _TEXT_CHARACTERS set)
        p = self._tmp_file(bytes(range(1, 7)) * 40)
        self.assertTrue(_is_binary(p))


class ScanTreeIntegrationTests(_CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_manifest_top_level_shape(self):
        m = scan_tree(str(FIXTURE))
        self.assertIn("root", m)
        self.assertIn("scanned_at", m)
        self.assertIn("tree", m)
        self.assertEqual(m["tree"]["type"], "directory")
        self.assertEqual(m["tree"]["path"], ".")
        self.assertEqual(m["tree"]["name"], "sample-repo")

    def test_counts_roll_up_correctly(self):
        m = scan_tree(str(FIXTURE))
        tree = m["tree"]
        self.assertEqual(tree["descendants_file_count"], 9)
        self.assertEqual(tree["descendants_dir_count"], 4)
        self.assertEqual(tree["descendants_count"], 13)
        self.assertGreater(tree["descendants_size"], 0)

    def test_signature_present_and_stable(self):
        m1 = scan_tree(str(FIXTURE))
        m2 = scan_tree(str(FIXTURE))
        self.assertIn("signature", m1)
        self.assertIsInstance(m1["signature"], str)
        self.assertEqual(m1["signature"], m2["signature"])

    def test_git_dates_present_on_tracked_file(self):
        m = scan_tree(str(FIXTURE))
        for node in _walk_files(m["tree"]):
            if node["name"] == "index.ts":
                self.assertIsNotNone(node["git"])
                self.assertEqual(node["git"]["created"], "2024-03-22T14:30:00Z")
                self.assertEqual(node["git"]["modified"], "2024-03-22T14:30:00Z")
                return
        self.fail("index.ts not found in manifest")

    def test_git_dir_is_excluded(self):
        m = scan_tree(str(FIXTURE))
        names = [n["name"] for n in _walk_dirs(m["tree"])]
        self.assertNotIn(".git", names)

    def test_binary_flag_on_png(self):
        m = scan_tree(str(FIXTURE))
        for node in _walk_files(m["tree"]):
            if node["name"] == "logo.png":
                self.assertTrue(node["binary"])
                return
        self.fail("logo.png not found in manifest")

    def test_untracked_files_excluded_from_git_repo(self):
        # In a git repo we always honor the tracked set — uncommitted files
        # don't appear in the manifest.
        untracked = FIXTURE / "untracked-temp.txt"
        untracked.write_text("not tracked")
        try:
            m = scan_tree(str(FIXTURE))
            names = [n["name"] for n in _walk_files(m["tree"])]
            self.assertNotIn("untracked-temp.txt", names)
        finally:
            untracked.unlink(missing_ok=True)


    def test_include_all_returns_untracked_files(self):
        # Default scan: untracked file is hidden (existing behavior).
        # include_all=True: untracked file appears in the tree.
        untracked = FIXTURE / "untracked-include-all.txt"
        untracked.write_text("hello include_all")
        try:
            m_default = scan_tree(str(FIXTURE))
            names_default = [n["name"] for n in _walk_files(m_default["tree"])]
            self.assertNotIn("untracked-include-all.txt", names_default)

            m_all = scan_tree(str(FIXTURE), include_all=True)
            names_all = [n["name"] for n in _walk_files(m_all["tree"])]
            self.assertIn("untracked-include-all.txt", names_all)

            # Untracked file has no git history.
            for node in _walk_files(m_all["tree"]):
                if node["name"] == "untracked-include-all.txt":
                    self.assertIsNotNone(node["git"])
                    self.assertIsNone(node["git"]["created"])
                    self.assertIsNone(node["git"]["modified"])
                    return
            self.fail("untracked-include-all.txt not found in include_all manifest")
        finally:
            untracked.unlink(missing_ok=True)

    def test_include_all_returns_gitignored_files(self):
        # Default scan: gitignored file is hidden (existing behavior).
        # include_all=True: gitignored file appears in the tree.
        # The fixture's .gitignore must list the path for git ls-files
        # to drop it; we restore it after.
        gitignore_path = FIXTURE / ".gitignore"
        original_gitignore = gitignore_path.read_text() if gitignore_path.exists() else ""
        ignored_file = FIXTURE / "ignored-include-all.txt"
        ignored_file.write_text("hidden by .gitignore")
        try:
            gitignore_path.write_text(
                original_gitignore + "\nignored-include-all.txt\n"
            )

            m_default = scan_tree(str(FIXTURE))
            names_default = [n["name"] for n in _walk_files(m_default["tree"])]
            self.assertNotIn("ignored-include-all.txt", names_default)

            m_all = scan_tree(str(FIXTURE), include_all=True)
            names_all = [n["name"] for n in _walk_files(m_all["tree"])]
            self.assertIn("ignored-include-all.txt", names_all)
        finally:
            ignored_file.unlink(missing_ok=True)
            if original_gitignore:
                gitignore_path.write_text(original_gitignore)
            else:
                gitignore_path.unlink(missing_ok=True)

    def test_include_all_no_op_outside_git_repo(self):
        # In a non-git directory, the tracked-files filter never engages,
        # so include_all should be a no-op (signature + tree shape match).
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "a.txt").write_text("a")
            (Path(tmp) / "b.txt").write_text("b")
            m_default = scan_tree(tmp)
            m_all = scan_tree(tmp, include_all=True)
            self.assertEqual(m_default["signature"], m_all["signature"])
            self.assertEqual(
                m_default["tree"]["descendants_file_count"],
                m_all["tree"]["descendants_file_count"],
            )

    def test_git_dir_still_excluded_with_include_all(self):
        # .git/ is excluded independent of the tracked-files filter.
        m = scan_tree(str(FIXTURE), include_all=True)
        names = [n["name"] for n in _walk_dirs(m["tree"])]
        self.assertNotIn(".git", names)

    def test_skip_list_excludes_node_modules_under_include_all(self):
        # node_modules/ must NOT appear with include_all=True. ALWAYS_SKIP
        # is hardcoded; there's no runtime escape hatch.
        nm_dir = FIXTURE / "node_modules" / "fake-pkg"
        nm_dir.mkdir(parents=True, exist_ok=True)
        nm_file = nm_dir / "index.js"
        nm_file.write_text("module.exports = {};")
        try:
            m = scan_tree(str(FIXTURE), include_all=True)
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn("node_modules", names)
        finally:
            nm_file.unlink(missing_ok=True)
            nm_dir.rmdir()
            (FIXTURE / "node_modules").rmdir()

    def test_codecityignore_name_excludes_directory(self):
        # A bare name in .codecityignore matches any dir/file with that
        # name anywhere in the tree.
        target_dir = FIXTURE / "noisy-fixture"
        target_dir.mkdir(exist_ok=True)
        (target_dir / "data.txt").write_text("noise")
        ignore_file = FIXTURE / ".codecityignore"
        ignore_file.write_text("# project-specific\nnoisy-fixture\n")
        try:
            m = scan_tree(str(FIXTURE), include_all=True)
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn("noisy-fixture", names)
        finally:
            ignore_file.unlink(missing_ok=True)
            (target_dir / "data.txt").unlink(missing_ok=True)
            target_dir.rmdir()

    def test_codecityignore_path_excludes_specific_path_only(self):
        # A line containing '/' is anchored to the scan root. A dir at
        # a different relative path with the same final segment is NOT
        # excluded.
        target_a = FIXTURE / "stash" / "legacy"
        target_b = FIXTURE / "legacy"  # same name, different path
        target_a.mkdir(parents=True, exist_ok=True)
        target_b.mkdir(exist_ok=True)
        (target_a / "x.txt").write_text("a")
        (target_b / "x.txt").write_text("b")
        ignore_file = FIXTURE / ".codecityignore"
        ignore_file.write_text("stash/legacy\n")
        try:
            m = scan_tree(str(FIXTURE), include_all=True)
            paths = [n["path"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn("stash/legacy", paths)
            # The other "legacy" at a different path stays visible.
            self.assertIn("legacy", paths)
        finally:
            ignore_file.unlink(missing_ok=True)
            (target_a / "x.txt").unlink(missing_ok=True)
            target_a.rmdir()
            (FIXTURE / "stash").rmdir()
            (target_b / "x.txt").unlink(missing_ok=True)
            target_b.rmdir()

    def test_codecityignore_missing_is_ok(self):
        # No file -> no error, scan proceeds normally.
        ignore_file = FIXTURE / ".codecityignore"
        self.assertFalse(ignore_file.exists())  # sanity
        m = scan_tree(str(FIXTURE), include_all=True)
        self.assertGreater(m["tree"]["descendants_file_count"], 0)

    def test_codecityignore_comments_and_blanks(self):
        # Comments and blank lines are silently dropped.
        target = FIXTURE / "noisy-comment-test"
        target.mkdir(exist_ok=True)
        (target / "x.txt").write_text("x")
        ignore_file = FIXTURE / ".codecityignore"
        ignore_file.write_text(
            "# leading comment\n"
            "\n"
            "noisy-comment-test\n"
            "   \n"  # blank-with-whitespace
            "# trailing comment\n"
        )
        try:
            m = scan_tree(str(FIXTURE), include_all=True)
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn("noisy-comment-test", names)
        finally:
            ignore_file.unlink(missing_ok=True)
            (target / "x.txt").unlink(missing_ok=True)
            target.rmdir()

    def test_codecityignore_negation_unignores_always_skip(self):
        # `!node_modules` overrides ALWAYS_SKIP, so the dir surfaces
        # under include_all=True.
        nm_dir = FIXTURE / "node_modules" / "fake-pkg"
        nm_dir.mkdir(parents=True, exist_ok=True)
        (nm_dir / "index.js").write_text("module.exports = {};")
        ignore_file = FIXTURE / ".codecityignore"
        ignore_file.write_text("!node_modules\n")
        try:
            m = scan_tree(str(FIXTURE), include_all=True)
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertIn("node_modules", names)
        finally:
            ignore_file.unlink(missing_ok=True)
            (nm_dir / "index.js").unlink(missing_ok=True)
            nm_dir.rmdir()
            (FIXTURE / "node_modules").rmdir()

    def test_codecityignore_negation_path_anchored(self):
        # `!stash/legacy` un-ignores only that exact path. Another dir
        # named `legacy` at a different rel-path stays affected by any
        # other ignore rule (here: nothing else, so it's visible too).
        target_a = FIXTURE / "stash" / "legacy"
        target_b = FIXTURE / "elsewhere" / "legacy"
        target_a.mkdir(parents=True, exist_ok=True)
        target_b.mkdir(parents=True, exist_ok=True)
        (target_a / "x.txt").write_text("a")
        (target_b / "x.txt").write_text("b")
        ignore_file = FIXTURE / ".codecityignore"
        # Ignore both names at the bare level, then un-ignore one path.
        ignore_file.write_text("legacy\n!stash/legacy\n")
        try:
            m = scan_tree(str(FIXTURE), include_all=True)
            paths = [n["path"] for n in _walk_dirs(m["tree"])]
            self.assertIn("stash/legacy", paths)
            self.assertNotIn("elsewhere/legacy", paths)
        finally:
            ignore_file.unlink(missing_ok=True)
            (target_a / "x.txt").unlink(missing_ok=True)
            target_a.rmdir()
            (FIXTURE / "stash").rmdir()
            (target_b / "x.txt").unlink(missing_ok=True)
            target_b.rmdir()
            (FIXTURE / "elsewhere").rmdir()

    def test_codecityignore_negation_does_not_unignore_git_dir(self):
        # `!.git` is silently ignored — walking the object database is
        # always disallowed regardless of user config.
        ignore_file = FIXTURE / ".codecityignore"
        ignore_file.write_text("!.git\n")
        try:
            m = scan_tree(str(FIXTURE), include_all=True)
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn(".git", names)
        finally:
            ignore_file.unlink(missing_ok=True)

    def test_scan_tree_emits_commits_list(self):
        m = scan_tree(str(FIXTURE), use_cache=False, git_window="30.years.ago")
        self.assertIn("commits", m)
        self.assertIsInstance(m["commits"], list)
        self.assertGreater(len(m["commits"]), 0)
        dates = [c["date"] for c in m["commits"]]
        self.assertEqual(dates, sorted(dates))

    def test_scan_tree_non_git_emits_null_commits(self):
        """Non-git root: commits is null, not an empty list."""
        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.txt").write_text("hello")
            m = scan_tree(td, use_cache=False)
        self.assertIsNone(m["commits"])


class SignatureTreeTests(_CacheRedirectMixin, unittest.TestCase):
    """signature_tree() must produce the same digest as scan_tree() does
    for the same root — that's the contract the live-update poll relies
    on. Drift here means every poll triggers a full reload."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_signature_matches_scan_tree(self):
        m = scan_tree(str(FIXTURE))
        s = signature_tree(str(FIXTURE))
        self.assertEqual(s["signature"], m["signature"])

    def test_signature_response_shape(self):
        s = signature_tree(str(FIXTURE))
        self.assertIn("root", s)
        self.assertIn("scanned_at", s)
        self.assertIn("signature", s)
        self.assertIsInstance(s["signature"], str)
        # No tree / repo fields — that's the whole point.
        self.assertNotIn("tree", s)
        self.assertNotIn("repo", s)

    def test_signature_changes_when_tracked_file_changes(self):
        # Add a tracked file, signature must shift; remove it, restored.
        before = signature_tree(str(FIXTURE))["signature"]
        new_file = FIXTURE / "sig-test-temp.txt"
        new_file.write_text("hello")
        try:
            subprocess.check_call(["git", "-C", str(FIXTURE), "add", str(new_file.name)])
            after_add = signature_tree(str(FIXTURE))["signature"]
            self.assertNotEqual(before, after_add)
        finally:
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "HEAD", new_file.name],
                check=False,
                capture_output=True,
            )
            new_file.unlink(missing_ok=True)

    def test_include_all_signature_matches_full_scan(self):
        # Parity contract still holds in include_all mode.
        m = scan_tree(str(FIXTURE), include_all=True)
        s = signature_tree(str(FIXTURE), include_all=True)
        self.assertEqual(s["signature"], m["signature"])

    def test_include_all_signature_differs_from_default(self):
        # Adding files that only show up under include_all must change
        # the signature relative to the default scan, otherwise the
        # frontend would never re-render after the toggle flips.
        untracked = FIXTURE / "sig-temp-include-all.txt"
        untracked.write_text("payload")
        try:
            default_sig = signature_tree(str(FIXTURE))["signature"]
            all_sig = signature_tree(str(FIXTURE), include_all=True)["signature"]
            self.assertNotEqual(default_sig, all_sig)
        finally:
            untracked.unlink(missing_ok=True)

    def test_signature_honors_codecityignore(self):
        # Parity contract: editing .codecityignore must shift the
        # signature returned by signature_tree (so the live-update poll
        # actually triggers a reload), and that signature must match
        # scan_tree's output for the same root.
        target = FIXTURE / "sig-noise-fixture"
        target.mkdir(exist_ok=True)
        (target / "x.txt").write_text("x")
        ignore_file = FIXTURE / ".codecityignore"
        try:
            # Without ignore file, target is visible.
            before_sig = signature_tree(str(FIXTURE), include_all=True)["signature"]
            before_full = scan_tree(str(FIXTURE), include_all=True)["signature"]
            self.assertEqual(before_sig, before_full)

            # Add ignore entry, both signatures must shift in lockstep.
            ignore_file.write_text("sig-noise-fixture\n")
            after_sig = signature_tree(str(FIXTURE), include_all=True)["signature"]
            after_full = scan_tree(str(FIXTURE), include_all=True)["signature"]
            self.assertEqual(after_sig, after_full)
            self.assertNotEqual(before_sig, after_sig)
        finally:
            ignore_file.unlink(missing_ok=True)
            (target / "x.txt").unlink(missing_ok=True)
            target.rmdir()


class LineCountCapTests(unittest.TestCase):
    """Above ~5 MB the line counter samples and extrapolates instead of
    reading the entire file. Building height is a relative measure, so
    an order-of-magnitude estimate is fine on huge files."""

    def test_exact_count_below_threshold(self):
        from codecity.scan import _line_count
        with tempfile.NamedTemporaryFile("wb", delete=False) as fh:
            fh.write(b"line\n" * 1000)
            small = Path(fh.name)
        self.addCleanup(small.unlink, missing_ok=True)
        self.assertEqual(_line_count(small), 1000)

    def test_sample_extrapolation_above_threshold(self):
        from codecity.scan import _line_count
        # 6 MB file with one newline every 50 bytes -> ~125k lines true.
        with tempfile.NamedTemporaryFile("wb", delete=False) as fh:
            line = b"x" * 49 + b"\n"  # 50 bytes, one newline
            for _ in range(6 * 1024 * 1024 // 50):
                fh.write(line)
            big = Path(fh.name)
        self.addCleanup(big.unlink, missing_ok=True)
        result = _line_count(big)
        # Sample-based estimate; allow ±20%.
        self.assertGreater(result, 100_000)
        self.assertLess(result, 150_000)


def _walk_files(node):
    """Yield every file node in the tree."""
    if node.get("type") == "file":
        yield node
    for c in node.get("children", []):
        yield from _walk_files(c)


def _walk_dirs(node):
    """Yield every directory node (including root)."""
    if node.get("type") == "directory":
        yield node
    for c in node.get("children", []):
        yield from _walk_dirs(c)


class GitMetadataParallelTests(_CacheRedirectMixin, unittest.TestCase):
    """The two git log walks (created + modified) are independent and
    should run concurrently."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_single_walk_invocation(self):
        # The combined --name-status walk replaces the previous two
        # parallel walks — _collect_git_metadata should now fire `git
        # log` exactly once. _collect_git_dates_windowed streams output
        # via Popen; the short auxiliary commands (rev-parse, ls-files)
        # go through subprocess.run. Wrap both so we catch git log
        # regardless of which API the implementation chose.
        from unittest.mock import patch
        from codecity.scan import _collect_git_metadata

        original_run = subprocess.run
        original_popen = subprocess.Popen
        log_calls: list[list[str]] = []

        def _record_if_git_log(args) -> None:
            if (
                isinstance(args, list)
                and args[:2] == ["git", "-C"]
                and "log" in args
            ):
                log_calls.append(list(args))

        def counting_run(args, **kwargs):
            _record_if_git_log(args)
            return original_run(args, **kwargs)

        def counting_popen(args, **kwargs):
            _record_if_git_log(args)
            return original_popen(args, **kwargs)

        with patch("codecity.scan.subprocess.run", side_effect=counting_run), \
             patch("codecity.scan.subprocess.Popen", side_effect=counting_popen):
            _collect_git_metadata(FIXTURE, use_cache=False)

        self.assertEqual(len(log_calls), 1,
                         f"expected exactly 1 git log call, got: {log_calls}")

    def test_collect_git_metadata_returns_commits_list(self):
        from codecity.scan import _collect_git_metadata
        _created, _modified, _tracked, commits = _collect_git_metadata(
            FIXTURE, use_cache=False, git_window="30.years.ago",
        )
        self.assertIsInstance(commits, list)
        self.assertGreater(len(commits), 0)
        # Manifest contract: oldest-first.
        dates = [c["date"] for c in commits]
        self.assertEqual(dates, sorted(dates),
                         f"commits should be oldest-first, got {dates}")
        for c in commits:
            self.assertEqual(set(c.keys()), {"date", "files"})
            self.assertEqual(len(c["date"]), 10)  # YYYY-MM-DD
            self.assertGreaterEqual(c["files"], 1)


class GitHistoryCacheTests(_CacheRedirectMixin, unittest.TestCase):
    """When HEAD hasn't moved, _collect_git_metadata should hit the
    persistent cache and skip the two `git log` walks entirely."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_warm_run_skips_git_log(self):
        from unittest.mock import patch
        from codecity.scan import _collect_git_metadata

        # Cold run: populates cache.
        _collect_git_metadata(FIXTURE, use_cache=True)

        original_run = subprocess.run
        log_calls: list[list[str]] = []

        def counting_run(args, **kwargs):
            if isinstance(args, list) and "log" in args:
                log_calls.append(list(args))
            return original_run(args, **kwargs)

        # Warm run: must not invoke `git log` at all.
        with patch("codecity.scan.subprocess.run", side_effect=counting_run):
            _collect_git_metadata(FIXTURE, use_cache=True)
        self.assertEqual(log_calls, [], "expected zero git log calls on warm run")

    def test_use_cache_false_bypasses(self):
        from unittest.mock import patch
        from codecity.scan import _collect_git_metadata

        _collect_git_metadata(FIXTURE, use_cache=True)  # populate

        original_run = subprocess.run
        original_popen = subprocess.Popen
        log_calls: list[list[str]] = []

        def _record_if_log(args) -> None:
            if isinstance(args, list) and "log" in args:
                log_calls.append(list(args))

        def counting_run(args, **kwargs):
            _record_if_log(args)
            return original_run(args, **kwargs)

        def counting_popen(args, **kwargs):
            _record_if_log(args)
            return original_popen(args, **kwargs)

        with patch("codecity.scan.subprocess.run", side_effect=counting_run), \
             patch("codecity.scan.subprocess.Popen", side_effect=counting_popen):
            _collect_git_metadata(FIXTURE, use_cache=False)
        self.assertEqual(len(log_calls), 1, "use_cache=False must run the combined log walk")

    def test_cache_invalidated_after_new_commit(self):
        # Make a commit, confirm next call re-walks history.
        from unittest.mock import patch
        from codecity.scan import _collect_git_metadata

        _collect_git_metadata(FIXTURE, use_cache=True)

        # Commit something to move HEAD.
        new_file = FIXTURE / "cache-bust.txt"
        new_file.write_text("bust")
        try:
            subprocess.check_call(
                ["git", "-C", str(FIXTURE), "add", str(new_file.name)]
            )
            subprocess.check_call(
                ["git", "-C", str(FIXTURE), "commit", "-q", "-m", "cache-bust"]
            )

            original_run = subprocess.run
            original_popen = subprocess.Popen
            log_calls: list[list[str]] = []

            def _record_if_log(args) -> None:
                if isinstance(args, list) and "log" in args:
                    log_calls.append(list(args))

            def counting_run(args, **kwargs):
                _record_if_log(args)
                return original_run(args, **kwargs)

            def counting_popen(args, **kwargs):
                _record_if_log(args)
                return original_popen(args, **kwargs)

            with patch("codecity.scan.subprocess.run", side_effect=counting_run), \
                 patch("codecity.scan.subprocess.Popen", side_effect=counting_popen):
                _collect_git_metadata(FIXTURE, use_cache=True)
            self.assertEqual(len(log_calls), 1,
                             "HEAD moved -> must re-walk")
        finally:
            # Reset fixture: undo the commit and remove the file.
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "--hard", "HEAD~1"],
                check=False, capture_output=True,
            )
            new_file.unlink(missing_ok=True)


class FileStatCacheTests(_CacheRedirectMixin, unittest.TestCase):
    """Warm runs of scan_tree should hit the file-stat cache for
    unchanged files and skip _is_binary + _line_count entirely."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_warm_run_skips_line_count(self):
        from unittest.mock import patch

        scan_tree(str(FIXTURE))  # cold: populates cache

        with patch("codecity.scan._line_count") as line_mock, \
             patch("codecity.scan._is_binary") as binary_mock:
            scan_tree(str(FIXTURE))  # warm: should not call either
            self.assertEqual(line_mock.call_count, 0,
                             "warm scan must not call _line_count")
            self.assertEqual(binary_mock.call_count, 0,
                             "warm scan must not call _is_binary")

    def test_warm_run_signature_matches_cold_run(self):
        cold = scan_tree(str(FIXTURE))
        warm = scan_tree(str(FIXTURE))
        self.assertEqual(cold["signature"], warm["signature"])
        # And tree shape — confirm `lines` survives the cache roundtrip.
        cold_lines = {
            n["path"]: n["lines"] for n in _walk_files(cold["tree"])
        }
        warm_lines = {
            n["path"]: n["lines"] for n in _walk_files(warm["tree"])
        }
        self.assertEqual(cold_lines, warm_lines)

    def test_modified_file_recomputed(self):
        from unittest.mock import patch

        scan_tree(str(FIXTURE))  # populate

        # Change one file's mtime by writing to it.
        target = next(
            n for n in _walk_files(scan_tree(str(FIXTURE))["tree"])
            if n["name"] == "index.ts"
        )
        target_path = Path(target["fullPath"])
        original_text = target_path.read_text()
        target_path.write_text(original_text + "\n// changed\n")

        try:
            line_calls: list[Path] = []
            original_line_count = _line_count_real()

            def counting_line_count(p):
                line_calls.append(p)
                return original_line_count(p)

            with patch("codecity.scan._line_count", side_effect=counting_line_count):
                scan_tree(str(FIXTURE))

            # Only the modified file should be recomputed.
            self.assertEqual(len(line_calls), 1)
            self.assertEqual(line_calls[0], target_path)
        finally:
            target_path.write_text(original_text)

    def test_use_cache_false_bypasses_file_cache(self):
        from unittest.mock import patch

        scan_tree(str(FIXTURE))  # populate cache

        with patch("codecity.scan._line_count", return_value=42) as line_mock:
            scan_tree(str(FIXTURE), use_cache=False)
            # use_cache=False -> every file gets re-read
            self.assertGreater(line_mock.call_count, 0)


def _line_count_real():
    """Get the unwrapped _line_count for tests that want to call the
    real implementation while also mocking it."""
    from codecity.scan import _line_count
    return _line_count


class TreeSignatureTests(unittest.TestCase):
    """compute_tree_signature produces a stable, structure-only fingerprint.

    The signature must:
    1. Be identical for identical tree shapes regardless of file metadata.
    2. Change when a file or directory is added or renamed.
    3. Be deterministic across multiple calls for the same tree.
    4. Be present in BOTH skeleton and final manifest events for the same scan.
    """

    def _make_tree(self, entries: list[dict]) -> dict:
        """Build a minimal DirNode-like dict for testing."""
        return {
            "type": "directory",
            "path": ".",
            "name": "root",
            "children": entries,
        }

    def _make_file(self, path: str, size: int = 100, mtime: float = 1_000_000.0) -> dict:
        """Build a minimal FileNode-like dict for testing."""
        return {
            "type": "file",
            "path": path,
            "name": path.rsplit("/", 1)[-1],
            "size": size,
            "mtime": mtime,
        }

    def test_same_shape_same_metadata_produces_same_signature(self):
        tree = self._make_tree([self._make_file("a.py"), self._make_file("b.py")])
        self.assertEqual(compute_tree_signature(tree), compute_tree_signature(tree))

    def test_same_shape_different_metadata_produces_same_signature(self):
        # Metadata (size, mtime) must NOT affect tree_signature.
        tree_a = self._make_tree([self._make_file("a.py", size=100, mtime=1.0)])
        tree_b = self._make_tree([self._make_file("a.py", size=999, mtime=9.9)])
        self.assertEqual(compute_tree_signature(tree_a), compute_tree_signature(tree_b))

    def test_adding_a_file_changes_signature(self):
        tree_before = self._make_tree([self._make_file("a.py")])
        tree_after = self._make_tree([self._make_file("a.py"), self._make_file("b.py")])
        self.assertNotEqual(
            compute_tree_signature(tree_before),
            compute_tree_signature(tree_after),
        )

    def test_renaming_a_file_changes_signature(self):
        tree_before = self._make_tree([self._make_file("a.py")])
        tree_after = self._make_tree([self._make_file("z.py")])
        self.assertNotEqual(
            compute_tree_signature(tree_before),
            compute_tree_signature(tree_after),
        )

    def test_adding_a_directory_changes_signature(self):
        tree_before = self._make_tree([self._make_file("a.py")])
        tree_after = self._make_tree([
            self._make_file("a.py"),
            {
                "type": "directory",
                "path": "sub",
                "name": "sub",
                "children": [self._make_file("sub/b.py")],
            },
        ])
        self.assertNotEqual(
            compute_tree_signature(tree_before),
            compute_tree_signature(tree_after),
        )

    def test_deterministic_across_repeated_calls(self):
        tree = self._make_tree([
            self._make_file("a.py"),
            self._make_file("b.py"),
            {
                "type": "directory",
                "path": "pkg",
                "name": "pkg",
                "children": [self._make_file("pkg/c.py")],
            },
        ])
        results = {compute_tree_signature(tree) for _ in range(5)}
        self.assertEqual(len(results), 1, "compute_tree_signature must be deterministic")

    def test_returns_hex_string_of_expected_length(self):
        # blake2b digest_size=8 → 8 bytes → 16 hex chars.
        tree = self._make_tree([self._make_file("a.py")])
        sig = compute_tree_signature(tree)
        self.assertIsInstance(sig, str)
        self.assertEqual(len(sig), 16)
        int(sig, 16)  # must be valid hex — raises ValueError if not

    def test_skeleton_and_final_manifests_share_same_tree_signature(self):
        """The same tree_signature must appear in both the skeleton and final
        manifest events for the same scan — the whole point of this feature."""
        from codecity.scan import scan_tree_streaming
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / "hello.py").write_text("x = 1\n")
            (Path(td) / "world.py").write_text("y = 2\n")
            events = list(scan_tree_streaming(td))
        self.assertEqual(len(events), 2)
        skeleton_sig = events[0]["manifest"]["tree_signature"]
        final_sig = events[1]["manifest"]["tree_signature"]
        self.assertEqual(skeleton_sig, final_sig,
                         "skeleton and final manifests must carry the same tree_signature")

    def test_tree_signature_stable_when_only_metadata_changes(self):
        """tree_signature must be unchanged when only file content/lines/binary
        differs — i.e., between skeleton and final phases."""
        from codecity.scan import scan_tree_streaming
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / "a.py").write_text("x = 1\n" * 100)
            events = list(scan_tree_streaming(td))
        skeleton = events[0]["manifest"]
        final = events[1]["manifest"]
        # Metadata-sensitive signature changes between skeleton and final.
        # tree_signature must NOT change.
        self.assertEqual(skeleton["tree_signature"], final["tree_signature"])


class ScanTreeStreamingTests(unittest.TestCase):
    def _make_tiny_repo(self, tmpdir: str) -> str:
        # Two files, no git init — keeps the test fast.
        (Path(tmpdir) / "a.py").write_text("x = 1\ny = 2\n")
        (Path(tmpdir) / "b.py").write_text("z = 3\n")
        return tmpdir

    def test_yields_skeleton_then_final(self) -> None:
        from codecity.scan import scan_tree_streaming
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            events = list(scan_tree_streaming(td))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["phase"], "skeleton")
        self.assertEqual(events[1]["phase"], "final")

    def test_skeleton_has_placeholder_metadata(self) -> None:
        from codecity.scan import scan_tree_streaming
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            skeleton, _final = list(scan_tree_streaming(td))
        # Walk the tree and assert every file has placeholder lines/binary.
        def files(node):
            for child in node["children"]:
                if child["type"] == "file":
                    yield child
                else:
                    yield from files(child)
        for f in files(skeleton["manifest"]["tree"]):
            self.assertEqual(f["lines"], 1, f"{f['path']} should have placeholder lines=1")
            self.assertFalse(f["binary"], f"{f['path']} should have placeholder binary=False")

    def test_final_matches_scan_tree(self) -> None:
        from codecity.scan import scan_tree, scan_tree_streaming
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            _skeleton, final = list(scan_tree_streaming(td))
            eager = scan_tree(td)
        # signature and scanned_at differ across separate calls; compare tree shape.
        self.assertEqual(final["manifest"]["tree"], eager["tree"])

    def test_cancel_event_pre_set_raises_at_first_boundary(self) -> None:
        import threading
        from codecity.scan import scan_tree_streaming, ScanCancelledError
        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            ev = threading.Event()
            ev.set()
            gen = scan_tree_streaming(td, cancel_event=ev)
            with self.assertRaises(ScanCancelledError):
                list(gen)

    def test_cancel_event_set_after_skeleton_raises_in_populate(self) -> None:
        import threading
        from codecity.scan import scan_tree_streaming, ScanCancelledError
        with TemporaryDirectory() as td:
            # Make enough files that the pool has work to do AFTER the
            # skeleton emits, so the event-set-after-skeleton case
            # genuinely interrupts metadata population.
            for i in range(20):
                (Path(td) / f"f{i}.py").write_text("x = 1\n" * 50)
            ev = threading.Event()
            gen = scan_tree_streaming(td, cancel_event=ev)
            skeleton = next(gen)
            self.assertEqual(skeleton["phase"], "skeleton")
            ev.set()
            with self.assertRaises(ScanCancelledError):
                next(gen)


class MediaDimsInScanTests(_CacheRedirectMixin, unittest.TestCase):
    def test_scan_stamps_png_dimensions(self):
        import struct, zlib
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            png = tmp_path / "pic.png"
            # Minimal 50x30 PNG.
            def chunk(tag, data):
                return (
                    struct.pack(">I", len(data))
                    + tag + data
                    + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
                )
            sig = b"\x89PNG\r\n\x1a\n"
            ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 50, 30, 8, 2, 0, 0, 0))
            raw = (b"\x00" + b"\xff\x00\x00" * 50) * 30
            idat = chunk(b"IDAT", zlib.compress(raw))
            iend = chunk(b"IEND", b"")
            png.write_bytes(sig + ihdr + idat + iend)

            manifest = scan_tree(str(tmp_path))
            files = [c for c in manifest["tree"]["children"] if c["type"] == "file"]
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]["media_width"], 50)
            self.assertEqual(files[0]["media_height"], 30)

            # Warm path: second scan should hit the file-stat cache and
            # still stamp media_width / media_height on the node — the
            # cache-hit branch in _populate_file_metadata.
            manifest2 = scan_tree(str(tmp_path))
            files2 = [c for c in manifest2["tree"]["children"] if c["type"] == "file"]
            self.assertEqual(len(files2), 1)
            self.assertEqual(files2[0]["media_width"], 50)
            self.assertEqual(files2[0]["media_height"], 30)

    def test_scan_omits_media_dims_for_non_media(self):
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "code.py").write_text("print('hi')\n")
            manifest = scan_tree(str(tmp_path))
            files = [c for c in manifest["tree"]["children"] if c["type"] == "file"]
            self.assertEqual(len(files), 1)
            self.assertNotIn("media_width", files[0])
            self.assertNotIn("media_height", files[0])


if __name__ == "__main__":
    unittest.main()
