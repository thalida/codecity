"""Tests for api.clone — the read-only clone-or-update helper.

Uses a local bare repo as the "remote" so tests don't hit the network.
``CLONES_ROOT`` is monkey-patched to a per-test tempdir so we never touch
the user's real ``~/.cache/codecity/``.
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import pytest

from api.git import clone as clone_mod
from api.git.clone import (
    BranchNotFoundError,
    CloneError,
    CloneInterruptedError,
    HostUnreachableError,
    RepoNotFoundError,
    _clean_git_stderr,
    _maybe_raise_clean_clone_error,
    _partial_clone_filter,
    ensure_clone,
    hydrate_blobs,
)
from api.errors import ScanCancelledError


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

    def test_clone_without_origin_head_still_checks_out(self) -> None:
        """A populated clone with no refs/remotes/origin/HEAD still gets checked
        out, and lands HEAD on a real branch."""
        local = ensure_clone(self.url)
        self.assertTrue((local / "README.md").is_file())

        # Reproduce the broken on-disk shape: branches present, origin/HEAD
        # gone, HEAD parked on the dangling ref git uses when it gives up.
        # `--delete` removes the symref itself; `update-ref -d` would deref it
        # and delete origin/main instead, which a fetch just puts back.
        _run("git", "symbolic-ref", "--delete", "refs/remotes/origin/HEAD", cwd=local)
        _run("git", "read-tree", "--empty", cwd=local)
        (local / "README.md").unlink()
        # Written directly: `git symbolic-ref` rejects the name git parks HEAD
        # on itself (a refname component may not start with a dot).
        (local / ".git" / "HEAD").write_text("ref: refs/heads/.invalid\n")
        self.assertEqual([p.name for p in local.iterdir() if p.name != ".git"], [])

        ensure_clone(self.url)
        self.assertTrue((local / "README.md").is_file())
        # A dangling HEAD survives `reset --hard`, leaving every history command
        # failing even once the files are back.
        log = subprocess.run(
            ["git", "-C", str(local), "log", "--oneline"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        self.assertIn("initial", log)
        # The repair is recorded, so the next load resolves it off the ref.
        head = subprocess.run(
            ["git", "-C", str(local), "symbolic-ref", "refs/remotes/origin/HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        self.assertEqual(head, f"refs/remotes/origin/{self.default_branch}")


SAMPLE_URL = "https://example.com/x.git"


@pytest.mark.parametrize(
    ("label", "branch", "stderr", "expected", "needle"),
    [
        (
            "branch missing on the first clone",
            "feature-x",
            "fatal: Remote branch feature-x not found in upstream origin",
            BranchNotFoundError,
            "feature-x",
        ),
        (
            "branch missing on the reset path",
            "feature-x",
            "fatal: ambiguous argument 'origin/feature-x': "
            "unknown revision or path not in the working tree.",
            BranchNotFoundError,
            None,
        ),
        (
            "repo missing",
            None,
            "ERROR: Repository not found.\nfatal: Could not read from remote repository.",
            RepoNotFoundError,
            None,
        ),
        (
            # A copied web-page URL (with a #anchor) reaches a server that is
            # not serving a git repo.
            "url reaches a server that is not a repo",
            None,
            "fatal: https://github.com/thalida/codecity#local-directories/"
            "info/refs not valid: is this a git repository?",
            RepoNotFoundError,
            "git repository",
        ),
        (
            "host does not resolve",
            None,
            "fatal: unable to access 'https://no-such-host.example/x.git/': "
            "Could not resolve host: no-such-host.example",
            HostUnreachableError,
            None,
        ),
        (
            # The real linux-kernel failure tail: a drop mid-transfer has to
            # read as retryable, not as a missing repo.
            "connection drops mid-transfer",
            "master",
            "error: RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly\n"
            "error: 3948 bytes of body are still expected\n"
            "fetch-pack: unexpected disconnect while reading sideband packet\n"
            "fatal: early EOF\n"
            "fatal: fetch-pack: invalid index-pack output",
            CloneInterruptedError,
            "try again",
        ),
    ],
)
def test_clone_stderr_classification(label, branch, stderr, expected, needle):
    with pytest.raises(expected) as excinfo:
        _maybe_raise_clean_clone_error(SAMPLE_URL, branch, stderr)
    if needle:
        assert needle in str(excinfo.value).lower()


# A host asking for credentials is the same situation as one that 404s: this
# server has none by design. The wording must not claim the repo is private,
# which is a guess the server cannot make.
@pytest.mark.parametrize(
    "stderr",
    [
        "fatal: Authentication failed for 'https://example.com/x.git/'",
        "remote: Credentials are incorrect or have expired",
        "remote: HTTP Basic: Access denied",
        "fatal: could not read Username for 'https://example.com': terminal prompts disabled",
        "git@example.com: Permission denied (publickey).",
    ],
)
def test_auth_failure_reads_as_unreachable(stderr):
    with pytest.raises(RepoNotFoundError) as excinfo:
        _maybe_raise_clean_clone_error(SAMPLE_URL, None, stderr)
    assert "private" not in str(excinfo.value).lower()


# Routers catch CloneError to map every clone failure onto one HTTP shape.
@pytest.mark.parametrize(
    "exc", [BranchNotFoundError, RepoNotFoundError, HostUnreachableError]
)
def test_clone_errors_share_a_base(exc):
    assert issubclass(exc, CloneError)


class NetGitRetryTests(unittest.TestCase):
    def test_retryable_falls_back_to_http1_1_then_succeeds(self) -> None:
        # A transient network drop retries and then succeeds. The first attempt
        # rides git's own default (HTTP/2 against GitHub); only the retry drops
        # to HTTP/1.1, so a healthy transfer keeps its multiplexing.
        calls: list[tuple[str, ...]] = []

        def fake(*args: str, **kw: object) -> str:
            calls.append(args)
            if len(calls) < 2:
                raise CloneError("git clone failed (exit 128): fatal: early EOF")
            return "ok"

        with (
            mock.patch.object(clone_mod, "_run_git_streaming", side_effect=fake),
            mock.patch.object(clone_mod.time, "sleep"),
        ):
            out = clone_mod._run_net_git("clone", "--", "url", "t")
        self.assertEqual(out, "ok")
        self.assertEqual(len(calls), 2)  # one retry
        self.assertNotIn("http.version=HTTP/1.1", calls[0])
        self.assertIn("http.version=HTTP/1.1", calls[1])

    def test_net_git_disables_background_maintenance(self) -> None:
        # Otherwise git's detached post-fetch maintenance keeps writing into the
        # clone, racing whoever deletes or scans it next.
        calls: list[tuple[str, ...]] = []

        def fake(*args: str, **kw: object) -> str:
            calls.append(args)
            return "ok"

        with mock.patch.object(clone_mod, "_run_git_streaming", side_effect=fake):
            clone_mod._run_net_git("fetch", "--refetch", "origin")
        self.assertIn("maintenance.auto=false", calls[0])
        self.assertIn("gc.auto=0", calls[0])
        # `-c key=value` only applies ahead of the subcommand.
        self.assertLess(calls[0].index("gc.auto=0"), calls[0].index("fetch"))

    def test_non_network_error_is_not_retried(self) -> None:
        calls: list[tuple[str, ...]] = []

        def fake(*args: str, **kw: object) -> str:
            calls.append(args)
            raise CloneError("fatal: Authentication failed")

        with mock.patch.object(clone_mod, "_run_git_streaming", side_effect=fake):
            with self.assertRaises(CloneError):
                clone_mod._run_net_git("fetch")
        self.assertEqual(len(calls), 1)  # no retry for a non-network failure

    def test_before_retry_cleans_up_between_attempts(self) -> None:
        cleaned: list[int] = []

        def fake(*args: str, **kw: object) -> str:
            raise CloneError("error: RPC failed; ... fatal: early EOF")

        with (
            mock.patch.object(clone_mod, "_run_git_streaming", side_effect=fake),
            mock.patch.object(clone_mod.time, "sleep"),
        ):
            with self.assertRaises(CloneError):
                clone_mod._run_net_git("clone", before_retry=lambda: cleaned.append(1))
        self.assertEqual(len(cleaned), clone_mod._NET_RETRY_ATTEMPTS - 1)

    def test_clean_git_stderr_strips_progress_noise(self) -> None:
        # A wall of --progress lines with the real error at the end → only the
        # error survives, no percentages.
        raw = (
            "remote: Enumerating objects: 8526369, done.\n"
            "Receiving objects:  66% (5643220/8526369), 1.41 GiB | 94.00 KiB/s\n"
            "Resolving deltas:  10% (1/10)\n"
            "error: RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly\n"
            "fatal: early EOF"
        )
        cleaned = _clean_git_stderr(raw)
        self.assertNotIn("Receiving objects", cleaned)
        self.assertNotIn("Enumerating objects", cleaned)
        self.assertNotIn("Resolving deltas", cleaned)
        self.assertIn("early EOF", cleaned)
        self.assertIn("RPC failed", cleaned)


class RunGitEnvTests(unittest.TestCase):
    def test_run_git_disables_terminal_prompt(self) -> None:
        from api.git import clone as clone_mod

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


class HydrateBlobsTests(unittest.TestCase):
    """hydrate_blobs backfills a blobless clone so the timeline can read
    historical blob content locally (no per-object promisor fetch hang)."""

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tmp_path = Path(self.tmp.name)

    def _blob_present(self, repo: Path, sha: str) -> bool:
        # -e checks existence; GIT_NO_LAZY_FETCH so a missing promisor blob
        # reports absent instead of being fetched by the check itself.
        return (
            subprocess.run(
                ["git", "-C", str(repo), "cat-file", "-e", sha],
                env={**os.environ, "GIT_NO_LAZY_FETCH": "1"},
                capture_output=True,
            ).returncode
            == 0
        )

    def _multi_commit_remote(self) -> Path:
        work = self.tmp_path / "work"
        work.mkdir()
        _run("git", "init", "-q", "--initial-branch=main", cwd=work)
        _run("git", "config", "user.email", "t@t", cwd=work)
        _run("git", "config", "user.name", "t", cwd=work)
        (work / "file.txt").write_text("one\n")
        _run("git", "add", "-A", cwd=work)
        _run("git", "commit", "-q", "-m", "v1", cwd=work)
        (work / "file.txt").write_text("one\ntwo\n")  # changes → old blob is history
        _run("git", "add", "-A", cwd=work)
        _run("git", "commit", "-q", "-m", "v2", cwd=work)
        bare = self.tmp_path / "remote.git"
        _run("git", "clone", "-q", "--bare", str(work), str(bare), cwd=self.tmp_path)
        _run("git", "symbolic-ref", "HEAD", "refs/heads/main", cwd=bare)
        # Without this a local bare silently ignores --filter and serves every
        # blob (GitHub has it on) — the clone below wouldn't actually be blobless.
        _run("git", "config", "uploadpack.allowFilter", "true", cwd=bare)
        return bare

    def test_hydrate_backfills_and_switches_filter(self) -> None:
        bare = self._multi_commit_remote()
        clone = self.tmp_path / "clone"
        # file:// (not a plain path) so the blob filter is honored, not a local
        # object hardlink that would defeat the partial clone.
        _run(
            "git",
            "clone",
            "-q",
            "--filter=blob:none",
            f"file://{bare}",
            str(clone),
            cwd=self.tmp_path,
        )
        v1_blob = subprocess.run(
            ["git", "-C", str(clone), "rev-parse", "HEAD~1:file.txt"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

        self.assertEqual(_partial_clone_filter(clone), "blob:none")
        self.assertFalse(self._blob_present(clone, v1_blob))  # history omitted

        self.assertTrue(hydrate_blobs(clone))
        self.assertTrue(_partial_clone_filter(clone).startswith("blob:limit"))
        self.assertTrue(self._blob_present(clone, v1_blob))  # now local

        self.assertFalse(hydrate_blobs(clone))  # idempotent: the marker is down

    def test_hydrate_retries_when_a_previous_attempt_did_not_finish(self) -> None:
        # The widened filter has to be in place for the refetch, so it cannot
        # double as "finished": a cancel mid-fetch used to leave the clone
        # looking hydrated with its history still missing, and every later
        # timeline read those blobs as 0 lines and 0 bytes.
        bare = self._multi_commit_remote()
        clone = self.tmp_path / "clone"
        _run(
            "git",
            "clone",
            "-q",
            "--filter=blob:none",
            f"file://{bare}",
            str(clone),
            cwd=self.tmp_path,
        )
        v1_blob = subprocess.run(
            ["git", "-C", str(clone), "rev-parse", "HEAD~1:file.txt"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

        with mock.patch.object(
            clone_mod, "_run_net_git", side_effect=ScanCancelledError()
        ):
            with self.assertRaises(ScanCancelledError):
                hydrate_blobs(clone)
        # Marked wide by the attempt, but the history never landed.
        self.assertTrue(_partial_clone_filter(clone).startswith("blob:limit"))
        self.assertFalse(self._blob_present(clone, v1_blob))

        self.assertTrue(hydrate_blobs(clone), "an unfinished hydrate must retry")
        self.assertTrue(self._blob_present(clone, v1_blob))

    def test_hydrate_noop_on_full_clone(self) -> None:
        # A plain (non-partial) repo has no filter → nothing to backfill.
        repo = self.tmp_path / "full"
        repo.mkdir()
        _run("git", "init", "-q", cwd=repo)
        self.assertIsNone(_partial_clone_filter(repo))
        self.assertFalse(hydrate_blobs(repo))


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

    def test_auth_failure_routes_to_repo_not_found(self) -> None:
        with TemporaryDirectory() as td:
            tmp = Path(td)
            self._patch_cache(tmp)
            with self.assertRaises(RepoNotFoundError):
                with mock.patch.object(
                    clone_mod,
                    "_run_git_streaming",
                    side_effect=CloneError(
                        "git clone failed (exit 128): "
                        "fatal: Authentication failed for 'https://example.com/x.git/'"
                    ),
                ):
                    ensure_clone("https://example.com/x.git", None)

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

    def test_corrupt_existing_clone_self_heals(self) -> None:
        with TemporaryDirectory() as td:
            tmp = Path(td)
            self._patch_cache(tmp)
            remote, _ = _make_fake_remote(tmp)
            url = str(remote)

            # First clone populates the cache with a valid working tree.
            target = ensure_clone(url)
            self.assertTrue((target / "README.md").is_file())

            # Corrupt it: drop .git so the next fetch fails with a NON-clean
            # error ("not a git repository") — the classic wedged clone that
            # fetch+reset can't repair (e.g. a clone interrupted mid-checkout).
            shutil.rmtree(target / ".git")
            self.assertFalse((target / ".git").exists())

            # ensure_clone must discard the broken clone and re-clone fresh
            # rather than surfacing the error or leaving it wedged.
            healed = ensure_clone(url)
            self.assertEqual(healed, target)
            self.assertTrue((target / ".git").is_dir())
            self.assertTrue((target / "README.md").is_file())


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
    from api.git.clone import _parse_clone_progress_line

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
    from api.git import clone as clone_mod

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
    with (
        mock.patch.object(clone_mod, "CLONES_ROOT", cache),
        # The subprocess layer is faked, so the checkout repair and LFS pull
        # would spawn a real git against a tree that doesn't exist.
        mock.patch.object(clone_mod, "_ensure_checkout"),
        mock.patch.object(clone_mod, "_pull_lfs"),
        mock.patch.object(subprocess, "Popen", return_value=FakeProc()),
    ):
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
    from api.git import clone as clone_mod

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
    with (
        mock.patch.object(clone_mod, "CLONES_ROOT", cache),
        # The subprocess layer is faked, so the checkout repair and LFS pull
        # would spawn a real git against a tree that doesn't exist.
        mock.patch.object(clone_mod, "_ensure_checkout"),
        mock.patch.object(clone_mod, "_pull_lfs"),
        mock.patch.object(subprocess, "Popen", return_value=FakeProc()),
    ):
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


class GitLfsTests(unittest.TestCase):
    """Git LFS materialization: a plain clone leaves LFS files as pointer stubs,
    so ensure_clone runs `git lfs pull` to swap in the real bytes. Mocked at the
    subprocess boundary so these run without git-lfs installed on the host."""

    def test_repo_uses_lfs_true_when_pointers_listed(self) -> None:
        with mock.patch.object(
            clone_mod, "_run_git", return_value="fonts/Inter.woff2\n"
        ):
            self.assertTrue(clone_mod._repo_uses_lfs(Path("/x")))

    def test_repo_uses_lfs_false_when_no_lfs_files(self) -> None:
        with mock.patch.object(clone_mod, "_run_git", return_value="\n"):
            self.assertFalse(clone_mod._repo_uses_lfs(Path("/x")))

    def test_repo_uses_lfs_false_when_git_lfs_unavailable(self) -> None:
        # Host without git-lfs: `git lfs ls-files` errors → treat as non-LFS and
        # fall back to a plain clone rather than crashing.
        with mock.patch.object(
            clone_mod, "_run_git", side_effect=CloneError("'lfs' is not a git command")
        ):
            self.assertFalse(clone_mod._repo_uses_lfs(Path("/x")))

    def test_pull_lfs_skips_non_lfs_repo(self) -> None:
        with (
            mock.patch.object(clone_mod, "_repo_uses_lfs", return_value=False),
            mock.patch.object(clone_mod, "_run_git_streaming") as streamed,
        ):
            clone_mod._pull_lfs(Path("/x"))
            streamed.assert_not_called()

    def test_pull_lfs_runs_git_lfs_pull(self) -> None:
        with (
            mock.patch.object(clone_mod, "_repo_uses_lfs", return_value=True),
            mock.patch.object(
                clone_mod, "_run_git_streaming", return_value=""
            ) as streamed,
        ):
            clone_mod._pull_lfs(Path("/x"))
            streamed.assert_called_once()
            self.assertEqual(streamed.call_args.args[:2], ("lfs", "pull"))

    def test_pull_lfs_swallows_failure(self) -> None:
        # LFS server down / quota / auth: leave the pointer files in place and
        # let the scan continue rather than failing the whole load.
        with (
            mock.patch.object(clone_mod, "_repo_uses_lfs", return_value=True),
            mock.patch.object(
                clone_mod,
                "_run_git_streaming",
                side_effect=CloneError("lfs fetch failed"),
            ),
        ):
            clone_mod._pull_lfs(Path("/x"))  # must not raise

    def test_pull_lfs_propagates_cancel(self) -> None:
        with (
            mock.patch.object(clone_mod, "_repo_uses_lfs", return_value=True),
            mock.patch.object(
                clone_mod, "_run_git_streaming", side_effect=ScanCancelledError()
            ),
        ):
            with self.assertRaises(ScanCancelledError):
                clone_mod._pull_lfs(Path("/x"))


class EnsureCloneLfsWiringTests(unittest.TestCase):
    """ensure_clone must invoke the LFS pull on both the fresh-clone and the
    update path, against the checked-out clone directory."""

    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.tmp_path = Path(self.tmp.name)
        self.cache = self.tmp_path / "cache"
        patch = mock.patch.object(clone_mod, "CLONES_ROOT", self.cache)
        patch.start()
        self.addCleanup(patch.stop)
        self.remote, _ = _make_fake_remote(self.tmp_path)
        self.url = str(self.remote)

    def test_fresh_clone_pulls_lfs(self) -> None:
        with mock.patch.object(clone_mod, "_pull_lfs") as pull:
            local = ensure_clone(self.url)
            pull.assert_called_once()
            self.assertEqual(pull.call_args.args[0], local)

    def test_update_path_pulls_lfs(self) -> None:
        ensure_clone(self.url)  # first clone (real pull, no-op on this repo)
        with mock.patch.object(clone_mod, "_pull_lfs") as pull:
            local = ensure_clone(self.url)  # second call takes the update path
            pull.assert_called_once()
            self.assertEqual(pull.call_args.args[0], local)


if __name__ == "__main__":
    unittest.main()
