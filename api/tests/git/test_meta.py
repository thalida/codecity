"""The git history walk: author lists, the single-pass date maps, merge
handling, non-UTF-8 robustness, and the history cache."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api.scan.filemeta import epoch_to_iso
from api.scan.scanner import scan_tree
from api.git import SourceRef
from api.tests.conftest import (
    CacheRedirectMixin,
    FIXTURE,
    commit_all,
    ensure_fixture,
    final_manifest as _final_manifest,
    init_repo,
    walk_files,
)


# The public authors list never carries an `@` or a domain. The email-only
# trailer is the privacy-critical branch the fixture commit doesn't reach.
@pytest.mark.parametrize(
    "trailers,expected",
    [
        ("", ["Alice"]),
        ("Bob <b@x>\x1fCarol <c@x>", ["Alice", "Bob", "Carol"]),
        # A cherry-pick can repeat the primary author as a trailer. Dropped,
        # with first-seen order preserved.
        ("Bob <b@x>\x1fAlice <a@x>", ["Alice", "Bob"]),
        # An email-only trailer must not leak the @domain.
        ("<bot@example.com>", ["Alice", "bot"]),
        ("<just-localpart>", ["Alice", "just-localpart"]),
        ("<>", ["Alice"]),
        ("Bob <b@x>\x1fBob <b@x>", ["Alice", "Bob"]),
    ],
    ids=[
        "no-trailers",
        "two-named",
        "primary-repeated",
        "email-only",
        "bracketed-without-at",
        "empty-brackets",
        "duplicate-co-author",
    ],
)
def test_build_authors_list(trailers, expected):
    from api.git.meta import build_authors_list

    assert build_authors_list("Alice", trailers) == expected


class GitHistoryParallelTests(CacheRedirectMixin, unittest.TestCase):
    """The two git log walks (created + modified) are independent and
    should run concurrently."""

    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_single_walk_invocation(self):
        # One combined walk means exactly one `git log`. Wrap Popen AND run,
        # so the assertion holds whichever API the implementation picks.
        from unittest.mock import patch
        from api.git.meta import collect_git_history

        original_run = subprocess.run
        original_popen = subprocess.Popen
        log_calls: list[list[str]] = []

        def _record_if_git_log(args) -> None:
            # The safe.directory prefix means "log" has no fixed position, so
            # match on the binary name plus "log" appearing as a token.
            if (
                isinstance(args, list)
                and len(args) > 0
                and args[0] == "git"
                and "log" in args
            ):
                log_calls.append(list(args))

        def counting_run(args, **kwargs):
            _record_if_git_log(args)
            return original_run(args, **kwargs)

        def counting_popen(args, **kwargs):
            _record_if_git_log(args)
            return original_popen(args, **kwargs)

        with (
            patch("api.git.meta.subprocess.run", side_effect=counting_run),
            patch("api.git.meta.subprocess.Popen", side_effect=counting_popen),
        ):
            collect_git_history(FIXTURE, use_cache=False)

        self.assertEqual(
            len(log_calls), 1, f"expected exactly 1 git log call, got: {log_calls}"
        )

    def test_collect_git_history_returns_commits_list(self):
        from api.git.meta import collect_git_history

        _created, _modified, commits = collect_git_history(
            FIXTURE,
            use_cache=False,
        )
        self.assertGreater(len(commits), 0)
        # Manifest contract: oldest-first.
        dates = [c.date for c in commits]
        self.assertEqual(
            dates, sorted(dates), f"commits should be oldest-first, got {dates}"
        )
        for c in commits:
            self.assertEqual(
                set(type(c).model_fields),
                {"date", "files", "sha", "authors", "subject", "same_day_total"},
            )
            # Full UTC timestamp, not a day: the scrubber needs the time to
            # separate same-day commits. One format so lexical == chronological.
            self.assertRegex(c.date, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
            self.assertGreaterEqual(c.files, 1)
            self.assertRegex(c.sha, r"^[0-9a-f]{40}$")
            self.assertGreater(len(c.authors), 0)
            self.assertGreater(len(c.authors[0]), 0)
            # Subject must NOT contain a newline — git %s is first line only.
            self.assertNotIn("\n", c.subject)

    def test_collect_git_history_captures_second_author_and_subject_only(self):
        """The fixture's "Other Fixture Person" commit is now the
        second-to-last commit (the multi-author "feat: co-authored work"
        commit is newest). Subject must be the first line only; author
        must be the second author's name (not the bot)."""
        from api.git.meta import collect_git_history

        _c, _m, commits = collect_git_history(
            FIXTURE,
            use_cache=False,
        )
        # commits are oldest-first; the multi-author commit is now last
        # and the Other Fixture Person commit is second-to-last.
        other = commits[-2]
        self.assertEqual(other.authors[0], "Other Fixture Person")
        self.assertEqual(other.subject, "docs: add CONTRIBUTORS")

    def test_co_authored_commit_returns_all_distinct_authors(self) -> None:
        """The multi-author fixture commit lists three Co-authored-by trailers
        (one email-only) plus a Signed-off-by (ignored) and a duplicate
        primary-author trailer (deduped). authors should be [primary, pair,
        reviewer, emailonly-bot] in that order — the email-only trailer is
        kept as its local-part to avoid leaking the @domain."""
        # The multi-author commit is now the newest; the scanner emits
        # oldest-first so it's last.
        events = list(scan_tree(str(FIXTURE), SourceRef(str(FIXTURE))))
        final = next(e for e in events if e.phase == "manifest-complete")
        commits = final.manifest.commits
        multi = commits[-1]
        self.assertEqual(
            multi.authors,
            [
                "Test Fixture Bot",
                "Pair Programmer",
                "Reviewer Person",
                "emailonly-bot",
            ],
        )
        # Subject of the multi-author commit (sanity check we're looking at
        # the right one).
        self.assertEqual(multi.subject, "feat: co-authored work")

    def test_collect_git_history_counts_merge_files(self):
        """A merge commit's combined-diff file count must be > 0, not the
        empty count git log emits by default for merges."""
        import tempfile
        from api.git.meta import collect_git_history

        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            subprocess.run(["git", "init", "-q", "-b", "main", td], check=True)
            subprocess.run(
                ["git", "-C", td, "config", "user.email", "t@example.com"], check=True
            )
            subprocess.run(["git", "-C", td, "config", "user.name", "T"], check=True)
            # Initial commit on main.
            (tdp / "base.txt").write_text("base\n")
            subprocess.run(["git", "-C", td, "add", "."], check=True)
            subprocess.run(["git", "-C", td, "commit", "-q", "-m", "base"], check=True)
            # Side branch that modifies a file.
            subprocess.run(
                ["git", "-C", td, "checkout", "-q", "-b", "side"], check=True
            )
            (tdp / "base.txt").write_text("side change\n")
            subprocess.run(
                ["git", "-C", td, "commit", "-aq", "-m", "side change"], check=True
            )
            # Back to main, modify same file differently, then merge.
            subprocess.run(["git", "-C", td, "checkout", "-q", "main"], check=True)
            (tdp / "base.txt").write_text("main change\n")
            subprocess.run(
                ["git", "-C", td, "commit", "-aq", "-m", "main change"], check=True
            )
            # Force a merge commit with a conflict resolution.
            subprocess.run(
                ["git", "-C", td, "merge", "-q", "--no-ff", "side"],
                capture_output=True,
            )
            # Conflict expected; resolve.
            (tdp / "base.txt").write_text("merged\n")
            subprocess.run(["git", "-C", td, "add", "."], check=True)
            subprocess.run(["git", "-C", td, "commit", "-aq", "--no-edit"], check=True)
            _c, _m, commits = collect_git_history(
                Path(td),
                use_cache=False,
            )
            # The merge commit (latest) MUST have files >= 1.
            # commits are oldest-first, so the merge is last.
            self.assertGreaterEqual(
                commits[-1].files,
                1,
                f"merge commit files count should be >= 1; got {commits[-1].files}",
            )

    def test_collect_git_history_counts_clean_merge_files(self):
        """A clean (non-conflicting) merge commit must also report its
        files. With `-c`, clean merges report 0; with
        `--diff-merges=first-parent` they report the side-branch diff."""
        import tempfile
        import subprocess
        from api.git.meta import collect_git_history

        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            subprocess.run(["git", "init", "-q", "-b", "main", td], check=True)
            subprocess.run(
                ["git", "-C", td, "config", "user.email", "t@example.com"], check=True
            )
            subprocess.run(["git", "-C", td, "config", "user.name", "T"], check=True)
            # Initial commit.
            (tdp / "a.txt").write_text("a\n")
            subprocess.run(["git", "-C", td, "add", "."], check=True)
            subprocess.run(
                ["git", "-C", td, "commit", "-q", "-m", "initial"], check=True
            )
            # Side branch adds a DIFFERENT file (no conflict with main).
            subprocess.run(
                ["git", "-C", td, "checkout", "-q", "-b", "side"], check=True
            )
            (tdp / "b.txt").write_text("b\n")
            subprocess.run(["git", "-C", td, "add", "."], check=True)
            subprocess.run(["git", "-C", td, "commit", "-q", "-m", "add b"], check=True)
            # Back to main, no changes here, then merge --no-ff.
            subprocess.run(["git", "-C", td, "checkout", "-q", "main"], check=True)
            subprocess.run(
                ["git", "-C", td, "merge", "-q", "--no-ff", "-m", "merge side", "side"],
                check=True,
            )
            _c, _m, commits = collect_git_history(
                Path(td),
                use_cache=False,
            )
            # Oldest-first, so the merge is [-1]. Diffed against first parent
            # (main, holding only a.txt) it introduces b.txt, so files >= 1.
            self.assertGreaterEqual(
                commits[-1].files,
                1,
                f"clean merge files count should be >= 1; got {commits[-1].files}",
            )

    def test_merge_does_not_overwrite_created_date(self):
        """A file added on a branch keeps its branch creation date; the merge
        that brings it onto main must NOT re-date it to the merge day."""
        import tempfile
        from api.git.meta import collect_git_history

        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)

            def run(*a: str) -> None:
                subprocess.run(["git", "-C", td, *a], check=True)

            subprocess.run(["git", "init", "-q", "-b", "main", td], check=True)
            run("config", "user.email", "t@example.com")
            run("config", "user.name", "T")
            (tdp / "a.txt").write_text("a\n")
            run("add", ".")
            run("commit", "-q", "-m", "initial", "--date=2020-01-01T00:00:00")
            run("checkout", "-q", "-b", "side")
            (tdp / "b.txt").write_text("b\n")
            run("add", ".")
            run(
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "-m",
                "add b",
                "--date=2020-02-01T00:00:00",
            )
            run("checkout", "-q", "main")
            run("merge", "-q", "--no-ff", "-m", "merge side", "side")
            created, _m, _commits = collect_git_history(Path(td), use_cache=False)
            self.assertEqual(created["b.txt"][:10], "2020-02-01")


class GitLogRobustnessTests(CacheRedirectMixin, unittest.TestCase):
    """The git-log streamer must survive two failure modes seen on real
    repos like torvalds/linux:

      A. Commit metadata that isn't valid UTF-8 (old Linux-kernel commits
         have raw Latin-1 bytes in author names — e.g. byte 0xe9 for 'é').
         Strict UTF-8 decoding raises UnicodeDecodeError mid-stream.
      B. Any exception escaping the parse loop must not deadlock the
         finally cleanup. ``proc.wait()`` on a child whose stdout pipe
         is full (we stopped reading) blocks forever — git can't exit
         until the pipe drains, and python won't drain because it's
         in wait(). Cleanup must kill the child before waiting.
    """

    def test_non_utf8_author_bytes_do_not_crash(self):
        """Failure mode A: a commit with non-UTF-8 author metadata must
        parse without raising. Bytes are replaced, not crashed-on."""
        from api.git.meta import collect_git_history

        with TemporaryDirectory() as td:
            td_path = Path(td)
            init_repo(td_path)
            (td_path / "f.txt").write_text("x\n")
            subprocess.run(["git", "-C", td, "add", "-A"], check=True)
            # By hand, so a raw 0xe9 survives into the author line:
            # GIT_AUTHOR_NAME would be silently re-encoded to valid UTF-8.
            tree_sha = subprocess.run(
                ["git", "-C", td, "write-tree"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            commit_body = (
                f"tree {tree_sha}\n".encode("ascii")
                + b"author Fran\xe9ois <f@example.com> 1577836800 +0000\n"
                + b"committer Fran\xe9ois <f@example.com> 1577836800 +0000\n"
                + b"\nmsg\n"
            )
            sha = (
                subprocess.run(
                    ["git", "-C", td, "hash-object", "-t", "commit", "-w", "--stdin"],
                    input=commit_body,
                    capture_output=True,
                    check=True,
                )
                .stdout.decode()
                .strip()
            )
            subprocess.run(
                ["git", "-C", td, "update-ref", "HEAD", sha],
                check=True,
            )

            # A deadline, so a regression that deadlocks the finally clause
            # fails loudly instead of hanging the worker forever.
            import threading

            result: dict[str, object] = {}

            def go() -> None:
                try:
                    _c, _m, commits = collect_git_history(
                        td_path,
                        use_cache=False,
                    )
                    result["commits"] = commits
                except BaseException as e:  # pragma: no cover - defensive
                    result["error"] = e

            t = threading.Thread(target=go, daemon=True)
            t.start()
            t.join(timeout=30)
            self.assertFalse(
                t.is_alive(),
                "scan deadlocked on non-UTF-8 metadata (likely "
                "finally: proc.wait() with a full stdout pipe)",
            )
            self.assertNotIn(
                "error",
                result,
                f"scan raised on non-UTF-8 metadata: {result!r}",
            )
            commits = result["commits"]
            assert isinstance(commits, list)
            self.assertEqual(len(commits), 1)
            author = commits[0].authors[0]
            self.assertIn("Fran", author)
            self.assertIn("ois", author)

    def test_parse_loop_exception_kills_subprocess_before_waiting(self):
        """Failure mode B: when the parse loop raises, cleanup must
        ``proc.kill()`` before ``proc.wait()``. Otherwise wait() blocks
        forever on any git child that still has buffered output."""
        from unittest.mock import patch
        from api.git.meta import _walk_git_log

        class _FakeStdout:
            """Yields one valid line, then raises — mimics the moment
            TextIOWrapper hits an invalid byte mid-stream."""

            def __init__(self) -> None:
                self._emitted = False

            def __iter__(self):
                return self

            def __next__(self) -> str:
                if not self._emitted:
                    self._emitted = True
                    return (
                        "COMMIT:2020-01-01T00:00:00+00:00\t"
                        + "a" * 40
                        + "\tAuthor\tsubj\n"
                    )
                raise UnicodeDecodeError(
                    "utf-8",
                    b"\xe9",
                    0,
                    1,
                    "simulated mid-stream failure",
                )

        class _FakeProc:
            """``wait()`` asserts ``kill()`` ran first — the real bug is
            that wait() on an unread-pipe child deadlocks, and the only
            way to avoid that is to kill the child first."""

            def __init__(self) -> None:
                self.stdout = _FakeStdout()
                self.killed = False
                self.waited = False
                self.returncode: int | None = None

            def poll(self) -> int | None:
                return self.returncode

            def kill(self) -> None:
                self.killed = True
                self.returncode = -9

            def wait(self, timeout: float | None = None) -> int:
                if not self.killed:
                    raise AssertionError(
                        "proc.wait() called without proc.kill() first — "
                        "this deadlocks on real git when stdout pipe is full"
                    )
                self.waited = True
                return self.returncode or 0

        fake = _FakeProc()
        with patch("api.git.meta.subprocess.Popen", return_value=fake):
            with self.assertRaises(UnicodeDecodeError):
                _walk_git_log(Path("/tmp/does-not-matter"), None)
        self.assertTrue(fake.killed, "cleanup must call proc.kill()")
        self.assertTrue(fake.waited, "cleanup must call proc.wait() after kill")


class GitHistoryCacheTests(CacheRedirectMixin, unittest.TestCase):
    """When HEAD hasn't moved, _collect_git_history should hit the
    persistent cache and skip the two `git log` walks entirely."""

    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_warm_run_skips_git_log(self):
        from unittest.mock import patch
        from api.git.meta import collect_git_history

        # Cold run: populates cache.
        collect_git_history(FIXTURE, use_cache=True)

        original_run = subprocess.run
        log_calls: list[list[str]] = []

        def counting_run(args, **kwargs):
            if isinstance(args, list) and "log" in args:
                log_calls.append(list(args))
            return original_run(args, **kwargs)

        # Warm run: must not invoke `git log` at all.
        with patch("api.git.meta.subprocess.run", side_effect=counting_run):
            collect_git_history(FIXTURE, use_cache=True)
        self.assertEqual(log_calls, [], "expected zero git log calls on warm run")

    def test_use_cache_false_bypasses(self):
        from unittest.mock import patch
        from api.git.meta import collect_git_history

        collect_git_history(FIXTURE, use_cache=True)  # populate

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

        with (
            patch("api.git.meta.subprocess.run", side_effect=counting_run),
            patch("api.git.meta.subprocess.Popen", side_effect=counting_popen),
        ):
            collect_git_history(FIXTURE, use_cache=False)
        self.assertEqual(
            len(log_calls), 1, "use_cache=False must run the combined log walk"
        )

    def test_cache_invalidated_after_new_commit(self):
        # Make a commit, confirm next call re-walks history.
        from unittest.mock import patch
        from api.git.meta import collect_git_history

        collect_git_history(FIXTURE, use_cache=True)

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

            with (
                patch("api.git.meta.subprocess.run", side_effect=counting_run),
                patch("api.git.meta.subprocess.Popen", side_effect=counting_popen),
            ):
                collect_git_history(FIXTURE, use_cache=True)
            self.assertEqual(len(log_calls), 1, "HEAD moved -> must re-walk")
        finally:
            # Reset fixture: undo the commit and remove the file.
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "--hard", "HEAD~1"],
                check=False,
                capture_output=True,
            )
            new_file.unlink(missing_ok=True)


def test_history_as_of_ref_excludes_future_commits(tmp_path):
    from api.git.meta import collect_git_history, run_git

    init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("1\n")
    commit_all(tmp_path, "c1")
    ref = run_git(tmp_path, "rev-parse", "HEAD").strip()
    # A later commit modifies a.txt; the ref-bound walk must not see it.
    (tmp_path / "a.txt").write_text("1\n2\n")
    (tmp_path / "b.txt").write_text("new\n")
    commit_all(tmp_path, "c2")

    created, modified, commits = collect_git_history(tmp_path, use_cache=False, ref=ref)
    assert "b.txt" not in modified  # b.txt didn't exist at ref
    assert len(commits) == 1  # only c1 is an ancestor of ref


class ScanDateResolutionTests(CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_fixture()

    def test_resolved_dates_prefer_git(self):
        # Resolved server-side: a committed file carries its git history
        # dates, not its filesystem ones.
        m = _final_manifest(str(FIXTURE))
        for node in walk_files(m.tree):
            if node.name == "index.ts":
                self.assertEqual(node.created, "2024-03-22T14:30:00Z")
                self.assertEqual(node.modified, "2024-03-22T14:30:00Z")
                self.assertNotIn("git", node)
                return
        self.fail("index.ts not found in manifest")

    def test_staged_uncommitted_file_gets_fs_dates(self):
        # A tracked-but-never-committed file has no git history dates;
        # the server resolves its created/modified from the filesystem.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "committed.txt").write_text("c")
            commit_all(root)
            staged = root / "staged.txt"
            staged.write_text("s")
            subprocess.run(["git", "-C", str(root), "add", "staged.txt"], check=True)

            st = staged.stat()
            expected_created = epoch_to_iso(getattr(st, "st_birthtime", st.st_ctime))
            expected_modified = epoch_to_iso(st.st_mtime)

            m = _final_manifest(str(root))
            for node in walk_files(m.tree):
                if node.name == "staged.txt":
                    self.assertEqual(node.created, expected_created)
                    self.assertEqual(node.modified, expected_modified)
                    return
            self.fail("staged.txt not found in manifest")

    def test_git_dates_normalized_to_utc(self):
        # %aI carries the author's offset; normalising to Z is what makes
        # lexical order chronological. 15:30+02:00 lands as 13:30Z.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            init_repo(root)
            (root / "offset.txt").write_text("o")
            subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
            subprocess.run(
                ["git", "-C", str(root), "commit", "-q", "-m", "x"],
                check=True,
                env={
                    **os.environ,
                    "GIT_AUTHOR_DATE": "2024-03-22T15:30:00+02:00",
                    "GIT_COMMITTER_DATE": "2024-03-22T15:30:00+02:00",
                },
            )

            m = _final_manifest(str(root))
            for node in walk_files(m.tree):
                if node.name == "offset.txt":
                    self.assertEqual(node.created, "2024-03-22T13:30:00Z")
                    self.assertEqual(node.modified, "2024-03-22T13:30:00Z")
                    return
            self.fail("offset.txt not found in manifest")
