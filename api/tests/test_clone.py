"""Tests for api.clone — the read-only clone-or-update helper.

Uses a local bare repo as the "remote" so tests don't hit the network.
``CLONES_ROOT`` is monkey-patched to a per-test tempdir so we never touch
the user's real ``~/.cache/codecity/``.
"""

from __future__ import annotations

import io
import os
import subprocess
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from api.services import clone as clone_mod
from api.services.clone import (
    BranchNotFoundError,
    CloneError,
    HostUnreachableError,
    RepoNotFoundError,
    _maybe_raise_clean_clone_error,
    ensure_clone,
)


os.environ["CODECITY_QUIET"] = "1"


def _run(*args: str, cwd: Path) -> None:
    subprocess.run(args, cwd=str(cwd), check=True, capture_output=True)


def _make_fake_remote(tmp: Path) -> tuple[Path, str]:
    """Build a tiny bare repo at ``tmp/remote.git`` with one initial commit
    on a 'main' branch and a 'feature' branch carrying a different file.
    Returns (remote_path, default_branch_name)."""
    work = tmp / "work"
    work.mkdir()
    _run("git", "init", "-q", "--initial-branch=main", cwd=work)
    _run("git", "config", "user.email", "test@example.com", cwd=work)
    _run("git", "config", "user.name", "Test", cwd=work)
    (work / "README.md").write_text("hello\n")
    _run("git", "add", "README.md", cwd=work)
    _run("git", "commit", "-q", "-m", "initial", cwd=work)
    _run("git", "checkout", "-q", "-b", "feature", cwd=work)
    (work / "FEATURE.md").write_text("on feature branch\n")
    _run("git", "add", "FEATURE.md", cwd=work)
    _run("git", "commit", "-q", "-m", "feature commit", cwd=work)
    _run("git", "checkout", "-q", "main", cwd=work)

    bare = tmp / "remote.git"
    _run("git", "clone", "-q", "--bare", str(work), str(bare), cwd=tmp)
    # Mark HEAD on the bare so symbolic-ref resolution works post-clone.
    _run("git", "symbolic-ref", "HEAD", "refs/heads/main", cwd=bare)
    return bare, "main"


class EnsureCloneTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tmp_path = Path(self.tmp.name)

        self.cache = self.tmp_path / "cache"
        self.cache_patch = mock.patch.object(clone_mod, "CLONES_ROOT", self.cache)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)

        self.remote, self.default_branch = _make_fake_remote(self.tmp_path)
        self.url = str(self.remote)

    def test_first_call_clones(self) -> None:
        local = ensure_clone(self.url)
        self.assertTrue(local.is_dir())
        self.assertTrue((local / ".git").is_dir())
        self.assertTrue((local / "README.md").is_file())

    def test_second_call_reuses_directory(self) -> None:
        first = ensure_clone(self.url)
        # Drop a sentinel file; if a reclone happened it would survive (we
        # reset --hard) but the marker we want is "no second .git inside".
        # Instead: verify the local path is identical and git rev-parse
        # still points at origin/main.
        second = ensure_clone(self.url)
        self.assertEqual(first, second)
        head = subprocess.run(
            ["git", "-C", str(second), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        self.assertTrue(head)

    def test_update_picks_up_remote_commits(self) -> None:
        local = ensure_clone(self.url)
        # Add a new commit to the bare via a temporary worktree on the remote.
        scratch = self.tmp_path / "scratch"
        _run("git", "clone", "-q", str(self.remote), str(scratch), cwd=self.tmp_path)
        _run("git", "config", "user.email", "test@example.com", cwd=scratch)
        _run("git", "config", "user.name", "Test", cwd=scratch)
        (scratch / "NEW.md").write_text("new file\n")
        _run("git", "add", "NEW.md", cwd=scratch)
        _run("git", "commit", "-q", "-m", "new", cwd=scratch)
        _run("git", "push", "-q", "origin", "main", cwd=scratch)

        ensure_clone(self.url)
        self.assertTrue((local / "NEW.md").is_file())

    def test_branch_picks_named_branch(self) -> None:
        local = ensure_clone(self.url, branch="feature")
        self.assertTrue((local / "FEATURE.md").is_file())
        # Different (url, branch) gets a different cache directory than no-branch.
        default = ensure_clone(self.url)
        self.assertNotEqual(local, default)

    def test_missing_remote_raises_clone_error(self) -> None:
        with self.assertRaises(CloneError):
            ensure_clone(str(self.tmp_path / "does-not-exist.git"))

    def test_empty_remote_no_commits_clones_without_error(self) -> None:
        """A brand-new remote with no commits has an unborn HEAD: the
        bare repo has no refs/heads/* and no resolvable origin/HEAD on
        clones. ensure_clone must produce an empty working tree rather
        than surfacing `git symbolic-ref … is not a symbolic ref` from
        the update-path reset. The frontend then renders an empty world.
        """
        empty_bare = self.tmp_path / "empty.git"
        _run("git", "init", "--bare", "-q", str(empty_bare), cwd=self.tmp_path)
        url = str(empty_bare)

        # First call (fresh clone path): git clone of an empty bare
        # succeeds with a working tree containing nothing.
        local = ensure_clone(url)
        self.assertTrue(local.is_dir())
        self.assertTrue((local / ".git").is_dir())
        # No files in the working tree (just .git/).
        files = [p.name for p in local.iterdir() if p.name != ".git"]
        self.assertEqual(files, [])

        # Second call (update path) — this is where the bug was: the
        # old code unconditionally called `git symbolic-ref
        # refs/remotes/origin/HEAD` which exits non-zero on an unborn
        # HEAD and bubbled the cryptic git stderr to the picker modal.
        ensure_clone(url)
        files_after = [p.name for p in local.iterdir() if p.name != ".git"]
        self.assertEqual(files_after, [])


class CleanCloneErrorDispatcherTests(unittest.TestCase):
    def test_branch_not_found_first_clone_stderr(self) -> None:
        with self.assertRaises(BranchNotFoundError) as ctx:
            _maybe_raise_clean_clone_error(
                "https://example.com/x.git",
                "feature-x",
                "fatal: Remote branch feature-x not found in upstream origin",
            )
        self.assertIn("feature-x", str(ctx.exception))

    def test_branch_not_found_reset_stderr(self) -> None:
        with self.assertRaises(BranchNotFoundError):
            _maybe_raise_clean_clone_error(
                "https://example.com/x.git",
                "feature-x",
                "fatal: ambiguous argument 'origin/feature-x': "
                "unknown revision or path not in the working tree.",
            )

    def test_repo_not_found(self) -> None:
        with self.assertRaises(RepoNotFoundError):
            _maybe_raise_clean_clone_error(
                "https://example.com/x.git",
                None,
                "ERROR: Repository not found.\n"
                "fatal: Could not read from remote repository.",
            )

    def test_host_unreachable(self) -> None:
        with self.assertRaises(HostUnreachableError):
            _maybe_raise_clean_clone_error(
                "https://no-such-host.example/x.git",
                None,
                "fatal: unable to access 'https://no-such-host.example/x.git/': "
                "Could not resolve host: no-such-host.example",
            )

    def test_auth_failure_passes_through(self) -> None:
        # Auth failures are NOT translated. Caller sees no exception from
        # the dispatcher — generic CloneError propagates from elsewhere.
        result = _maybe_raise_clean_clone_error(
            "https://example.com/x.git",
            None,
            "fatal: Authentication failed for 'https://example.com/x.git/'",
        )
        self.assertIsNone(result)

    def test_subclass_relationship(self) -> None:
        self.assertTrue(issubclass(BranchNotFoundError, CloneError))
        self.assertTrue(issubclass(RepoNotFoundError, CloneError))
        self.assertTrue(issubclass(HostUnreachableError, CloneError))


class RunGitEnvTests(unittest.TestCase):
    def test_run_git_disables_terminal_prompt(self) -> None:
        from api.services import clone as clone_mod

        captured = {}

        def fake_run(*args, **kwargs):
            captured["env"] = kwargs.get("env")

            class R:
                returncode = 0
                stdout = ""
                stderr = ""

            return R()

        with mock.patch.object(subprocess, "run", side_effect=fake_run):
            clone_mod._run_git("status")

        env = captured["env"]
        self.assertIsNotNone(env)
        self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")
        self.assertEqual(env["GIT_ASKPASS"], "/usr/bin/true")
        self.assertEqual(env["SSH_ASKPASS"], "/usr/bin/true")


class EnsureCloneErrorRoutingTests(unittest.TestCase):
    def _patch_cache(self, tmp: Path) -> None:
        self._cache_patch = mock.patch.object(clone_mod, "CLONES_ROOT", tmp / "cache")
        self._cache_patch.start()
        self.addCleanup(self._cache_patch.stop)

    def test_first_clone_branch_not_found_translated_and_cleaned(self) -> None:
        with TemporaryDirectory() as td:
            tmp = Path(td)
            self._patch_cache(tmp)
            remote, _ = _make_fake_remote(tmp)
            with self.assertRaises(BranchNotFoundError):
                ensure_clone(str(remote), branch="no-such-branch")
            # Target dir should have been cleaned up.
            target = clone_mod.clone_dir_for(str(remote), "no-such-branch")
            self.assertFalse(target.exists(), "partial clone dir was left behind")

    def test_repo_not_found_translated(self) -> None:
        with TemporaryDirectory() as td:
            tmp = Path(td)
            self._patch_cache(tmp)
            with self.assertRaises(RepoNotFoundError):
                # /nonexistent.git: git emits "Repository ... does not exist"
                # On macOS/Linux this manifests as "fatal: ...: '...' does not appear to be a git repository"
                # We mock the streaming runner (used by first-clone) to emit
                # the canonical "Repository not found" stderr.
                with mock.patch.object(
                    clone_mod,
                    "_run_git_streaming",
                    side_effect=CloneError(
                        "git clone failed (exit 128): ERROR: Repository not found."
                    ),
                ):
                    ensure_clone("https://example.com/nonexistent.git", None)

    def test_host_unreachable_translated(self) -> None:
        with TemporaryDirectory() as td:
            tmp = Path(td)
            self._patch_cache(tmp)
            with self.assertRaises(HostUnreachableError):
                with mock.patch.object(
                    clone_mod,
                    "_run_git_streaming",
                    side_effect=CloneError(
                        "git clone failed (exit 128): "
                        "fatal: unable to access 'https://nope.example/': "
                        "Could not resolve host: nope.example"
                    ),
                ):
                    ensure_clone("https://nope.example/x.git", None)

    def test_auth_failure_passes_through_as_generic(self) -> None:
        with TemporaryDirectory() as td:
            tmp = Path(td)
            self._patch_cache(tmp)
            with self.assertRaises(CloneError) as ctx:
                with mock.patch.object(
                    clone_mod,
                    "_run_git_streaming",
                    side_effect=CloneError(
                        "git clone failed (exit 128): "
                        "fatal: Authentication failed for 'https://example.com/x.git/'"
                    ),
                ):
                    ensure_clone("https://example.com/x.git", None)
            self.assertNotIsInstance(ctx.exception, BranchNotFoundError)
            self.assertNotIsInstance(ctx.exception, RepoNotFoundError)
            self.assertNotIsInstance(ctx.exception, HostUnreachableError)

    def test_update_path_failure_keeps_existing_dir(self) -> None:
        with TemporaryDirectory() as td:
            tmp = Path(td)
            self._patch_cache(tmp)
            remote, _ = _make_fake_remote(tmp)
            url = str(remote)

            # Step 1: Clone the 'feature' branch successfully — populates the
            # cache at clone_dir_for(url, "feature").
            target = ensure_clone(url, branch="feature")
            self.assertTrue(target.exists())
            self.assertTrue((target / "FEATURE.md").is_file())

            # Step 2: Delete the 'feature' branch from the underlying remote so
            # that the next fetch prunes it from the remote-tracking refs.
            subprocess.run(
                ["git", "-C", str(remote), "branch", "-D", "feature"],
                check=True,
                capture_output=True,
            )

            # Step 3: Call ensure_clone again for the same (url, "feature") pair.
            # The cache dir exists → update path runs:
            #   git fetch --prune origin  (succeeds, prunes origin/feature)
            #   git reset --hard origin/feature  (fails — unknown revision)
            # → caught by dispatcher → BranchNotFoundError.
            with self.assertRaises(BranchNotFoundError):
                ensure_clone(url, branch="feature")

            # Step 4: The existing cache dir must NOT have been removed.
            self.assertTrue(
                target.exists(),
                "update-path failure removed the existing clone directory",
            )


class _SilentFakeProc:
    """subprocess.Popen stand-in whose stderr/stdout return EOF
    immediately but whose wait() blocks for ``runtime`` seconds. Mimics
    the real-world failure mode the watchdog exists to surface: a git
    sub-process that's doing work (pack download) but emitting nothing
    to stderr."""

    returncode = 0

    def __init__(self, runtime: float) -> None:
        self.stdout = io.BytesIO(b"")
        self.stderr = io.BytesIO(b"")
        self._done = threading.Event()
        threading.Timer(runtime, self._done.set).start()

    def wait(self) -> int:
        self._done.wait()
        return 0


class StallWatchdogTests(unittest.TestCase):
    def test_pack_dir_bytes_sums_top_level_files(self) -> None:
        with TemporaryDirectory() as td:
            pack = Path(td) / "pack"
            pack.mkdir()
            (pack / "pack-aaa.pack").write_bytes(b"x" * 1500)
            (pack / "pack-aaa.idx").write_bytes(b"y" * 500)
            self.assertEqual(clone_mod._pack_dir_bytes(pack), 2000)

    def test_pack_dir_bytes_missing_dir_returns_zero(self) -> None:
        # The .git/objects/pack dir doesn't exist for the first ~second
        # of a clone; helper must not raise.
        self.assertEqual(clone_mod._pack_dir_bytes(Path("/nonexistent/path/xyz")), 0)

    def test_heartbeat_fires_when_subprocess_is_silent(self) -> None:
        """Watchdog emits 'still working' line when stderr is quiet past
        the threshold. This is the protection against the
        --filter=blob:none silent-blob-fetch UX bug."""
        captured: list[str] = []
        fake = _SilentFakeProc(runtime=0.6)
        with mock.patch.object(clone_mod, "_STALL_HEARTBEAT_SECS", 0.15):
            with mock.patch.object(clone_mod, "_log", side_effect=captured.append):
                with mock.patch.object(subprocess, "Popen", return_value=fake):
                    clone_mod._run_git_streaming("ignored")
        heartbeats = [m for m in captured if "still working" in m]
        self.assertGreaterEqual(
            len(heartbeats),
            1,
            f"expected at least one heartbeat; got: {captured}",
        )

    def test_heartbeat_includes_pack_size_when_progress_dir_set(self) -> None:
        """When progress_dir is provided, heartbeat surfaces pack-dir
        bytes so the user sees download progress during silent fetch."""
        captured: list[str] = []
        with TemporaryDirectory() as td:
            pack = Path(td) / "pack"
            pack.mkdir()
            (pack / "pack-xyz.pack").write_bytes(b"z" * 3 * 1024 * 1024)  # 3 MB

            fake = _SilentFakeProc(runtime=0.5)
            with mock.patch.object(clone_mod, "_STALL_HEARTBEAT_SECS", 0.15):
                with mock.patch.object(clone_mod, "_log", side_effect=captured.append):
                    with mock.patch.object(subprocess, "Popen", return_value=fake):
                        clone_mod._run_git_streaming("ignored", progress_dir=pack)

        heartbeats = [m for m in captured if "still working" in m]
        self.assertTrue(heartbeats, f"no heartbeat fired; got: {captured}")
        # First heartbeat reports current size (no delta yet).
        self.assertIn("3 MB on disk", heartbeats[0])

    def test_heartbeat_suppressed_when_subprocess_chats(self) -> None:
        """A subprocess that produces output and exits promptly should
        NOT trigger heartbeats — the watchdog only fires during silence.
        Simulates a small clone that finishes naturally."""

        class ChattyFakeProc:
            returncode = 0

            def __init__(self) -> None:
                lines = (
                    b"\n".join(
                        f"Resolving deltas: {p}%".encode() for p in range(0, 100, 10)
                    )
                    + b"\n"
                )
                self.stdout = io.BytesIO(b"")
                self.stderr = io.BytesIO(lines)
                self._done = threading.Event()
                # Exit before the silent gap exceeds the heartbeat
                # threshold (0.15s). Mirrors a real fast clone where
                # stderr finishes a few ms before proc.wait returns.
                threading.Timer(0.05, self._done.set).start()

            def wait(self) -> int:
                self._done.wait()
                return 0

        captured: list[str] = []
        with mock.patch.object(clone_mod, "_STALL_HEARTBEAT_SECS", 0.15):
            with mock.patch.object(clone_mod, "_log", side_effect=captured.append):
                with mock.patch.object(
                    subprocess, "Popen", return_value=ChattyFakeProc()
                ):
                    clone_mod._run_git_streaming("ignored")

        heartbeats = [m for m in captured if "still working" in m]
        self.assertEqual(
            len(heartbeats),
            0,
            f"watchdog fired during active output: {captured}",
        )
        git_lines = [m for m in captured if "Resolving deltas" in m]
        self.assertEqual(len(git_lines), 10, f"missing git lines: {captured}")


def test_parse_clone_progress_line():
    """Real git --progress emits lines like:
        Receiving objects:  45% (123/273), 1.20 MiB | 2.50 MiB/s
    The parser extracts (stage, percent) when matchable, else None.
    """
    from api.services.clone import _parse_clone_progress_line

    cases = [
        ("Receiving objects:  45% (123/273), 1.20 MiB | 2.50 MiB/s", ("receiving", 45)),
        ("Resolving deltas:  100% (50/50), done.", ("resolving", 100)),
        ("Counting objects:  12%", ("counting", 12)),
        ("Updating files:  59% (7321/12408)", ("updating", 59)),  # checkout phase
        ("Cloning into '/tmp/foo'...", None),
        ("", None),
        ("garbage line", None),
    ]
    for line, expected in cases:
        assert _parse_clone_progress_line(line) == expected, f"failed for: {line!r}"


def test_ensure_clone_emits_throttled_progress_via_callback(tmp_path):
    """ensure_clone should call the on_progress callback for parseable
    progress lines. Real git on a tiny repo doesn't always emit
    progress, so we fake the Popen and synthesize the stderr stream.
    The invariant — callback fires with (stage, percent) tuples for
    each parseable line — is what matters."""
    from unittest.mock import MagicMock
    from api.services import clone as clone_mod

    # \r is git's in-place rewrite separator for progress lines; the
    # drain splits on either \r or \n so we use \n here for readability.
    fake_stderr = (
        b"Cloning into '/tmp/foo'...\n"
        b"Counting objects:  10%\n"
        b"Counting objects:  50%\n"
        b"Counting objects: 100%\n"
        b"Receiving objects:   1%\n"
        b"Receiving objects:  50%\n"
        b"Receiving objects: 100%\n"
        b"Resolving deltas: 100%\n"
    )

    class FakeProc:
        returncode = 0

        def __init__(self) -> None:
            self.stdout = io.BytesIO(b"")
            self.stderr = io.BytesIO(fake_stderr)

        def wait(self) -> int:
            return 0

    cache = tmp_path / "cache"
    on_progress = MagicMock()
    with mock.patch.object(clone_mod, "CLONES_ROOT", cache):
        with mock.patch.object(subprocess, "Popen", return_value=FakeProc()):
            clone_mod.ensure_clone(
                "https://example.com/foo.git", None, on_progress=on_progress
            )

    assert on_progress.call_count >= 1, (
        f"callback should fire at least once; calls={on_progress.call_args_list}"
    )
    for call in on_progress.call_args_list:
        args = call.args[0]
        assert isinstance(args, tuple) and len(args) == 2
        assert args[0] in {"counting", "receiving", "resolving"}
        assert 0 <= args[1] <= 100
    # Verify the throttle: at least one stage-transition payload should
    # come through (counting → receiving or receiving → resolving), and
    # total should be capped (we sent 7 progress lines; expect ≤ 7 fires
    # but ≥ 1, with throttling further reducing within-stage duplicates).
    seen_stages = {call.args[0][0] for call in on_progress.call_args_list}
    assert len(seen_stages) >= 1, "expected at least one stage emitted"
    assert on_progress.call_count <= 7, (
        "throttle should not let every line through unbounded"
    )


def test_ensure_clone_emits_terminal_percent_of_each_stage(tmp_path):
    """Regression: when the throttle suppresses the terminal percent of
    a stage (e.g. 100%), the user gets stuck at whatever value last
    passed the throttle. The fix flushes the latest seen payload on
    stage change AND at end-of-stream. Verify the user always sees
    100% as the final payload for each stage."""
    from unittest.mock import MagicMock
    from api.services import clone as clone_mod

    # Many rapid progress lines per stage; the throttle will block
    # most of them. Without the flush fix, "Receiving 100%" gets
    # silently dropped because it lands within 250ms of the previous
    # emit, leaving the UI frozen at e.g. 66%.
    fake_stderr = (
        b"Cloning into '/tmp/foo'...\n"
        b"Counting objects:  10%\n"
        b"Counting objects:  50%\n"
        b"Counting objects:  75%\n"
        b"Counting objects: 100%\n"
        b"Receiving objects:   1%\n"
        b"Receiving objects:  33%\n"
        b"Receiving objects:  66%\n"
        b"Receiving objects:  99%\n"
        b"Receiving objects: 100%\n"
        b"Resolving deltas:   1%\n"
        b"Resolving deltas:  50%\n"
        b"Resolving deltas:  99%\n"
        b"Resolving deltas: 100%\n"
    )

    class FakeProc:
        returncode = 0

        def __init__(self) -> None:
            self.stdout = io.BytesIO(b"")
            self.stderr = io.BytesIO(fake_stderr)

        def wait(self) -> int:
            return 0

    cache = tmp_path / "cache"
    on_progress = MagicMock()
    with mock.patch.object(clone_mod, "CLONES_ROOT", cache):
        with mock.patch.object(subprocess, "Popen", return_value=FakeProc()):
            clone_mod.ensure_clone(
                "https://example.com/foo.git", None, on_progress=on_progress
            )

    # Collect per-stage the highest percent ever emitted.
    per_stage_max: dict[str, int] = {}
    for call in on_progress.call_args_list:
        stage, percent = call.args[0]
        per_stage_max[stage] = max(per_stage_max.get(stage, 0), percent)

    # Every stage we sent must have ended with 100% reaching the UI.
    assert per_stage_max.get("counting") == 100, (
        f"counting should reach 100%; per-stage max: {per_stage_max}"
    )
    assert per_stage_max.get("receiving") == 100, (
        f"receiving should reach 100%; per-stage max: {per_stage_max}"
    )
    assert per_stage_max.get("resolving") == 100, (
        f"resolving should reach 100%; per-stage max: {per_stage_max}"
    )


if __name__ == "__main__":
    unittest.main()
