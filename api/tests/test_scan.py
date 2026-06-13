"""Unit tests for api/scan.py."""

from __future__ import annotations

import fcntl
import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from api.services.scan import (
    _annotate_same_day_totals,
    _compute_busyness,
    _compute_date_ranges,
    _epoch_to_iso,
    _extension,
    _is_binary,
    compute_tree_signature,
    scan_tree,
    signature_tree,
)
from api.services.manifest_types import Manifest


# CODECITY_QUIET=1 is set by the session-autouse ``quiet_logs`` fixture
# in api/tests/conftest.py.


def _final_manifest(root: str, **kwargs) -> Manifest:
    """Drain scan_tree() and return only the final-phase manifest.

    Most tests pre-date the streaming refactor and assert against the
    full manifest, not the skeleton — this wrapper keeps them
    point-free of the phase iteration."""
    final: Manifest | None = None
    for event in scan_tree(root, **kwargs):
        if event["phase"] == "manifest-complete":
            final = event["manifest"]
    assert final is not None, "scan_tree must yield a final event"
    return final


def _init_repo(root: Path) -> None:
    """Initialize ``root`` as a git working tree with user.name/email set.

    scan_tree / signature_tree reject non-git roots, so every tempdir
    test in this file builds the smallest possible repo before scanning.
    """
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "t"], check=True)


def _commit_all(root: Path, message: str = "x") -> None:
    """Stage every file under ``root`` and create a commit."""
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", message], check=True)


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
_CANONICAL_FIXTURE = FIXTURES_DIR / "sample-repo"


def _resolve_fixture() -> Path:
    """Return the sample-repo path this worker should use.

    Many tests in this file mutate ``FIXTURE`` (write .codecityignore,
    create stash/ and node_modules/ subdirs, commit cache-bust files,
    etc.). Under pytest-xdist's ``-n auto`` those writes race across
    worker processes. To isolate, each xdist worker gets its own private
    copy under ``$TMPDIR/codecity-test-fixtures/<worker>/sample-repo``.
    When running serially (no PYTEST_XDIST_WORKER env var), use the
    canonical in-tree path so behavior is unchanged.
    """
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if not worker:
        return _CANONICAL_FIXTURE
    base = Path(tempfile.gettempdir()) / "codecity-test-fixtures" / worker
    return base / "sample-repo"


FIXTURE = _resolve_fixture()


def _ensure_fixture() -> None:
    """Make sure fixtures/setup.sh has been run, with per-worker copies
    when running under pytest-xdist.

    setup.sh starts with `rm -rf` and only commits at the end, so a
    second worker that enters this function mid-build and sees `.git`
    already exists (git init has run) will skip setup.sh and read /
    copytree a partial fixture (3 files from commit 1 instead of 9
    from commits 1+2). We serialize the canonical build with an
    exclusive file lock and gate the skip-decision on a sentinel
    file that's only written after setup.sh completes successfully —
    `.git` existence alone is not enough.

    The sentinel records the sha256 of setup.sh, not just existence.
    Any change to setup.sh (new commits, new files, renamed authors)
    invalidates the on-disk fixture and forces a rebuild. Without this,
    an older fixture from before a setup.sh edit silently survives and
    causes assertion failures that look like product bugs.
    """
    sentinel = FIXTURES_DIR / ".sample-repo-ready"
    lockfile_path = FIXTURES_DIR / ".sample-repo-setup.lock"
    setup_script = FIXTURES_DIR / "setup.sh"
    setup_hash = hashlib.sha256(setup_script.read_bytes()).hexdigest()
    lockfile_path.touch(exist_ok=True)
    with open(lockfile_path) as fp:
        fcntl.flock(fp.fileno(), fcntl.LOCK_EX)
        try:
            recorded = sentinel.read_text().strip() if sentinel.is_file() else ""
            if recorded != setup_hash:
                # Wipe any partial state from an interrupted prior run
                # so setup.sh's `rm -rf` isn't the only safety net.
                if _CANONICAL_FIXTURE.exists():
                    shutil.rmtree(_CANONICAL_FIXTURE)
                subprocess.check_call(["bash", str(setup_script)])
                sentinel.write_text(setup_hash)
        finally:
            fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
    # Per-worker copy: safe outside the lock because the canonical sentinel
    # now guards future setup.sh runs (nothing else can mutate the canonical)
    # and each worker writes to its own unique FIXTURE path. The per-worker
    # marker tracks the same setup.sh hash so an edit between pytest runs
    # invalidates stale worker copies too (without this, .git-exists alone
    # would silently reuse a copy made from the prior setup.sh).
    if FIXTURE != _CANONICAL_FIXTURE:
        worker_marker = FIXTURE.parent / ".sample-repo-ready"
        recorded = worker_marker.read_text().strip() if worker_marker.is_file() else ""
        if recorded != setup_hash or not (FIXTURE / ".git").is_dir():
            if FIXTURE.exists():
                shutil.rmtree(FIXTURE)
            FIXTURE.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(_CANONICAL_FIXTURE, FIXTURE)
            worker_marker.write_text(setup_hash)


class _CacheRedirectMixin:
    """Bridge that pulls in the ``redirect_cache_root`` conftest fixture
    for unittest-style test classes. Autouse fixtures fire on
    unittest.TestCase subclasses (unlike parameter-injected fixtures),
    so this preserves the per-test CACHE_ROOT redirect behavior the old
    mixin provided.
    """

    @pytest.fixture(autouse=True)
    def _redirect_cache_root(self, redirect_cache_root: Path) -> None:
        # Exposed for tests that need the path; most callers just rely
        # on the side-effect of redirecting api.cache.CACHE_ROOT.
        self.cache_root = redirect_cache_root


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


class ComputeBusynessTests(unittest.TestCase):
    @staticmethod
    def _commits(*per_day: int) -> list:
        # Build commits across distinct dates with the given per-day counts.
        out = []
        for day, n in enumerate(per_day, start=1):
            for _ in range(n):
                out.append(
                    {
                        "date": f"2026-01-{day:02d}",
                        "files": 1,
                        "sha": "0" * 40,
                        "authors": [],
                        "subject": "",
                    }
                )
        return out

    def test_empty_history(self):
        self.assertEqual(_compute_busyness([]), {"avg": 1, "busy": 1})

    def test_percentile_bands(self):
        # Per-day counts sorted: [1, 1, 2, 5]
        #   avg  = q(0.50) = counts[floor(4*0.5)=2] = 2
        #   busy = max(q(0.75)=counts[floor(4*0.75)=3]=5, avg+1=3) = 5
        self.assertEqual(
            _compute_busyness(self._commits(1, 1, 2, 5)), {"avg": 2, "busy": 5}
        )

    def test_busy_clamped_to_avg_plus_one(self):
        # Uniform 2-per-day → median 2, 75th pct 2 → busy clamps to 3.
        self.assertEqual(
            _compute_busyness(self._commits(2, 2, 2, 2)), {"avg": 2, "busy": 3}
        )


class ComputeDateRangesTests(unittest.TestCase):
    @staticmethod
    def _tree(*files: tuple[str, str, str]) -> dict:
        # Minimal DirNode with (name, created, modified) file children —
        # _compute_date_ranges only reads type/children/created/modified.
        return {
            "type": "directory",
            "path": ".",
            "name": "root",
            "children": [
                {
                    "type": "file",
                    "path": name,
                    "name": name,
                    "created": created,
                    "modified": modified,
                }
                for name, created, modified in files
            ],
        }

    def test_empty_tree_is_all_none(self):
        self.assertEqual(
            _compute_date_ranges(self._tree()),
            {
                "createdMin": None,
                "createdMax": None,
                "modifiedMin": None,
                "modifiedMax": None,
            },
        )

    def test_single_file_min_equals_max(self):
        ranges = _compute_date_ranges(
            self._tree(("a.py", "2024-01-10T09:00:00Z", "2024-03-22T14:30:00Z"))
        )
        self.assertEqual(
            ranges,
            {
                "createdMin": "2024-01-10T09:00:00Z",
                "createdMax": "2024-01-10T09:00:00Z",
                "modifiedMin": "2024-03-22T14:30:00Z",
                "modifiedMax": "2024-03-22T14:30:00Z",
            },
        )

    def test_multi_file_lexical_extremes(self):
        ranges = _compute_date_ranges(
            self._tree(
                ("a.py", "2024-02-15T10:00:00Z", "2024-02-15T10:00:00Z"),
                ("b.py", "2024-01-10T09:00:00Z", "2024-03-22T14:30:00Z"),
                ("c.py", "2024-01-20T12:00:00Z", "2024-01-20T12:00:00Z"),
            )
        )
        self.assertEqual(
            ranges,
            {
                "createdMin": "2024-01-10T09:00:00Z",
                "createdMax": "2024-02-15T10:00:00Z",
                "modifiedMin": "2024-01-20T12:00:00Z",
                "modifiedMax": "2024-03-22T14:30:00Z",
            },
        )


class AnnotateSameDayTotalsTests(unittest.TestCase):
    def test_sets_per_day_group_size_on_each_commit(self):
        # Three commits on 01-01, one on 01-02.
        commits = [
            {
                "date": "2026-01-01",
                "files": 1,
                "sha": "0" * 40,
                "authors": [],
                "subject": "",
            },
            {
                "date": "2026-01-01",
                "files": 1,
                "sha": "1" * 40,
                "authors": [],
                "subject": "",
            },
            {
                "date": "2026-01-01",
                "files": 1,
                "sha": "2" * 40,
                "authors": [],
                "subject": "",
            },
            {
                "date": "2026-01-02",
                "files": 1,
                "sha": "3" * 40,
                "authors": [],
                "subject": "",
            },
        ]
        _annotate_same_day_totals(commits)
        self.assertEqual([c["same_day_total"] for c in commits], [3, 3, 3, 1])

    def test_empty_history_is_a_noop(self):
        commits: list = []
        _annotate_same_day_totals(commits)
        self.assertEqual(commits, [])


class ScanTreeIntegrationTests(_CacheRedirectMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_manifest_top_level_shape(self):
        m = _final_manifest(str(FIXTURE))
        self.assertIn("root", m)
        self.assertIn("scanned_at", m)
        self.assertIn("tree", m)
        self.assertEqual(m["tree"]["type"], "directory")
        self.assertEqual(m["tree"]["path"], ".")
        self.assertEqual(m["tree"]["name"], "sample-repo")

    def test_counts_roll_up_correctly(self):
        m = _final_manifest(str(FIXTURE))
        tree = m["tree"]
        # +1 for CONTRIBUTORS.md (second-author commit) and +1 for
        # MULTIAUTHOR.md (multi-author/co-authored commit).
        self.assertEqual(tree["descendants_file_count"], 11)
        self.assertEqual(tree["descendants_dir_count"], 4)
        # descendants_count = files + dirs.
        self.assertEqual(tree["descendants_count"], 15)
        self.assertGreater(tree["descendants_size"], 0)

    def test_ext_breakdown_rolls_up(self):
        m = _final_manifest(str(FIXTURE))
        tree = m["tree"]
        breakdown = tree["descendants_ext_breakdown"]
        self.assertIsInstance(breakdown, list)
        for entry in breakdown:
            self.assertEqual(set(entry.keys()), {"ext", "count", "size"})
        # Per-ext counts/sizes partition the descendant files exactly.
        self.assertEqual(
            sum(e["count"] for e in breakdown), tree["descendants_file_count"]
        )
        self.assertEqual(sum(e["size"] for e in breakdown), tree["descendants_size"])
        # Sorted by count descending.
        counts = [e["count"] for e in breakdown]
        self.assertEqual(counts, sorted(counts, reverse=True))
        # Extension keys are lowercase, dot-prefixed; the fixture has .md files.
        self.assertIn(".md", {e["ext"] for e in breakdown})

    def test_ext_breakdown_leaf_dir_only_counts_own_files(self):
        # A nested directory's breakdown must cover only its own subtree,
        # not the whole repo.
        m = _final_manifest(str(FIXTURE))

        def _find_dir_with_files(node):
            if node["type"] != "directory":
                return None
            if node["children_file_count"] > 0 and node["path"] != ".":
                return node
            for child in node["children"]:
                found = _find_dir_with_files(child)
                if found:
                    return found
            return None

        sub = _find_dir_with_files(m["tree"])
        if sub is not None:
            self.assertEqual(
                sum(e["count"] for e in sub["descendants_ext_breakdown"]),
                sub["descendants_file_count"],
            )

    def test_busyness_present_in_manifest(self):
        m = _final_manifest(str(FIXTURE))
        b = m["busyness"]
        self.assertEqual(set(b.keys()), {"avg", "busy"})
        self.assertIsInstance(b["avg"], int)
        self.assertIsInstance(b["busy"], int)
        # Bands stay distinct: busy is always at least avg + 1.
        self.assertGreaterEqual(b["busy"], b["avg"] + 1)

    def test_date_ranges_present_in_manifest(self):
        m = _final_manifest(str(FIXTURE))
        r = m["dateRanges"]
        self.assertEqual(
            set(r.keys()), {"createdMin", "createdMax", "modifiedMin", "modifiedMax"}
        )
        # Cross-check: recompute the extremes independently from the
        # emitted tree's resolved per-file dates.
        created = [n["created"] for n in _walk_files(m["tree"])]
        modified = [n["modified"] for n in _walk_files(m["tree"])]
        self.assertGreater(len(created), 0)
        self.assertEqual(r["createdMin"], min(created))
        self.assertEqual(r["createdMax"], max(created))
        self.assertEqual(r["modifiedMin"], min(modified))
        self.assertEqual(r["modifiedMax"], max(modified))

    def test_date_ranges_present_on_every_emit(self):
        # Both SSE phases route through _wrap_manifest, so both must carry
        # dateRanges — and the skeleton's tree already has the resolved
        # dates, so the two are equal.
        events = list(scan_tree(str(FIXTURE), use_cache=False))
        phases = [e["phase"] for e in events]
        self.assertIn("manifest-partial", phases)
        self.assertIn("manifest-complete", phases)
        ranges = [e["manifest"]["dateRanges"] for e in events]
        for r in ranges:
            self.assertEqual(
                set(r.keys()),
                {"createdMin", "createdMax", "modifiedMin", "modifiedMax"},
            )
        self.assertEqual(ranges[0], ranges[1])

    def test_same_day_total_baked_on_every_commit(self):
        m = _final_manifest(str(FIXTURE))
        commits = m["commits"]
        self.assertGreater(len(commits), 0)
        # Recompute the per-day grouping independently and assert each
        # commit's baked same_day_total matches (>= 1, includes self).
        per_day: dict[str, int] = {}
        for c in commits:
            per_day[c["date"]] = per_day.get(c["date"], 0) + 1
        for c in commits:
            self.assertIn("same_day_total", c)
            self.assertEqual(c["same_day_total"], per_day[c["date"]])
            self.assertGreaterEqual(c["same_day_total"], 1)

    def test_same_day_total_present_on_every_emit(self):
        # same_day_total is NotRequired on the internal TypedDict (it's baked
        # in-place at wrap time) but REQUIRED on the wire. Both the skeleton
        # and final emits route through _wrap_manifest, so both must carry it
        # on every commit. Guards against a future emit path skipping wrap.
        events = list(scan_tree(str(FIXTURE), use_cache=False))
        phases = [e["phase"] for e in events]
        self.assertIn("manifest-partial", phases)
        self.assertIn("manifest-complete", phases)
        for e in events:
            for c in e["manifest"]["commits"]:
                self.assertIn(
                    "same_day_total", c, f"{e['phase']} commit missing same_day_total"
                )

    def test_signature_present_and_stable(self):
        m1 = _final_manifest(str(FIXTURE))
        m2 = _final_manifest(str(FIXTURE))
        self.assertIn("signature", m1)
        self.assertIsInstance(m1["signature"], str)
        self.assertEqual(m1["signature"], m2["signature"])

    def test_resolved_dates_prefer_git(self):
        # created/modified are resolved server-side: a committed file
        # carries its git history dates (the fixture pins index.ts's
        # commit date), not its filesystem dates — and the old dual
        # `git` block is gone from the wire.
        m = _final_manifest(str(FIXTURE))
        for node in _walk_files(m["tree"]):
            if node["name"] == "index.ts":
                self.assertEqual(node["created"], "2024-03-22T14:30:00Z")
                self.assertEqual(node["modified"], "2024-03-22T14:30:00Z")
                self.assertNotIn("git", node)
                return
        self.fail("index.ts not found in manifest")

    def test_staged_uncommitted_file_gets_fs_dates(self):
        # A tracked-but-never-committed file has no git history dates;
        # the server resolves its created/modified from the filesystem.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            (root / "committed.txt").write_text("c")
            _commit_all(root)
            staged = root / "staged.txt"
            staged.write_text("s")
            subprocess.run(["git", "-C", str(root), "add", "staged.txt"], check=True)

            st = staged.stat()
            expected_created = _epoch_to_iso(getattr(st, "st_birthtime", st.st_ctime))
            expected_modified = _epoch_to_iso(st.st_mtime)

            m = _final_manifest(str(root))
            for node in _walk_files(m["tree"]):
                if node["name"] == "staged.txt":
                    self.assertEqual(node["created"], expected_created)
                    self.assertEqual(node["modified"], expected_modified)
                    return
            self.fail("staged.txt not found in manifest")

    def test_git_dates_normalized_to_utc(self):
        # git %aI carries the author's UTC offset; the scanner normalizes
        # to Z-suffixed UTC so every date on the wire shares one format
        # and lexical order == chronological order (dateRanges relies on
        # this). A commit authored at 15:30+02:00 lands as 13:30Z.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
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
            for node in _walk_files(m["tree"]):
                if node["name"] == "offset.txt":
                    self.assertEqual(node["created"], "2024-03-22T13:30:00Z")
                    self.assertEqual(node["modified"], "2024-03-22T13:30:00Z")
                    return
            self.fail("offset.txt not found in manifest")

    def test_git_dir_is_excluded(self):
        m = _final_manifest(str(FIXTURE))
        names = [n["name"] for n in _walk_dirs(m["tree"])]
        self.assertNotIn(".git", names)

    def test_binary_flag_on_png(self):
        m = _final_manifest(str(FIXTURE))
        for node in _walk_files(m["tree"]):
            if node["name"] == "logo.png":
                self.assertTrue(node["binary"])
                return
        self.fail("logo.png not found in manifest")

    def test_media_kind_on_file_nodes(self):
        # A media file carries its backend-computed classification; a code
        # file carries None. This is the single source the frontend reads.
        m = _final_manifest(str(FIXTURE))
        kinds = {n["name"]: n.get("mediaKind") for n in _walk_files(m["tree"])}
        self.assertEqual(kinds.get("logo.png"), "image")
        self.assertIsNone(kinds.get("package.json"))

    def test_untracked_files_excluded_from_git_repo(self):
        # In a git repo we always honor the tracked set — uncommitted files
        # don't appear in the manifest.
        untracked = FIXTURE / "untracked-temp.txt"
        untracked.write_text("not tracked")
        try:
            m = _final_manifest(str(FIXTURE))
            names = [n["name"] for n in _walk_files(m["tree"])]
            self.assertNotIn("untracked-temp.txt", names)
        finally:
            untracked.unlink(missing_ok=True)

    def test_codecityignore_name_excludes_directory(self):
        # A bare name in .codecityignore matches any dir/file with that
        # name anywhere in the tree.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            (root / "keep.txt").write_text("k")
            target_dir = root / "noisy-fixture"
            target_dir.mkdir()
            (target_dir / "data.txt").write_text("noise")
            _commit_all(root)
            (root / ".codecityignore").write_text("# project-specific\nnoisy-fixture\n")
            m = _final_manifest(str(root))
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn("noisy-fixture", names)

    def test_codecityignore_path_excludes_specific_path_only(self):
        # A line containing '/' is anchored to the scan root. A dir at
        # a different relative path with the same final segment is NOT
        # excluded.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            target_a = root / "stash" / "legacy"
            target_b = root / "legacy"  # same name, different path
            target_a.mkdir(parents=True)
            target_b.mkdir()
            (target_a / "x.txt").write_text("a")
            (target_b / "x.txt").write_text("b")
            _commit_all(root)
            (root / ".codecityignore").write_text("stash/legacy\n")
            m = _final_manifest(str(root))
            paths = [n["path"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn("stash/legacy", paths)
            # The other "legacy" at a different path stays visible.
            self.assertIn("legacy", paths)

    def test_codecityignore_missing_is_ok(self):
        # No file -> no error, scan proceeds normally.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            (root / "a.txt").write_text("a")
            _commit_all(root)
            self.assertFalse((root / ".codecityignore").exists())  # sanity
            m = _final_manifest(str(root))
            self.assertGreater(m["tree"]["descendants_file_count"], 0)

    def test_codecityignore_comments_and_blanks(self):
        # Comments and blank lines are silently dropped.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            target = root / "noisy-comment-test"
            target.mkdir()
            (target / "x.txt").write_text("x")
            _commit_all(root)
            (root / ".codecityignore").write_text(
                "# leading comment\n"
                "\n"
                "noisy-comment-test\n"
                "   \n"  # blank-with-whitespace
                "# trailing comment\n"
            )
            m = _final_manifest(str(root))
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn("noisy-comment-test", names)

    def test_codecityignore_negation_unignores_always_skip(self):
        # `!node_modules` overrides ALWAYS_SKIP, so the dir surfaces.
        # node_modules is normally gitignored; here we force it into the
        # repo so the ALWAYS_SKIP rule is the only thing hiding it.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            nm_dir = root / "node_modules" / "fake-pkg"
            nm_dir.mkdir(parents=True)
            (nm_dir / "index.js").write_text("module.exports = {};")
            _commit_all(root)
            (root / ".codecityignore").write_text("!node_modules\n")
            m = _final_manifest(str(root))
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertIn("node_modules", names)

    def test_codecityignore_negation_path_anchored(self):
        # `!stash/legacy` un-ignores only that exact path. Another dir
        # named `legacy` at a different rel-path stays excluded by the
        # bare `legacy` rule.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            target_a = root / "stash" / "legacy"
            target_b = root / "elsewhere" / "legacy"
            target_a.mkdir(parents=True)
            target_b.mkdir(parents=True)
            (target_a / "x.txt").write_text("a")
            (target_b / "x.txt").write_text("b")
            _commit_all(root)
            # Ignore both names at the bare level, then un-ignore one path.
            (root / ".codecityignore").write_text("legacy\n!stash/legacy\n")
            m = _final_manifest(str(root))
            paths = [n["path"] for n in _walk_dirs(m["tree"])]
            self.assertIn("stash/legacy", paths)
            self.assertNotIn("elsewhere/legacy", paths)

    def test_codecityignore_negation_does_not_unignore_git_dir(self):
        # `!.git` is silently ignored — walking the object database is
        # always disallowed regardless of user config. _init_repo gives
        # us a real .git/ directory; the hardcoded `name == ".git"`
        # check should drop it even with the negation in place.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            (root / "keep.txt").write_text("k")
            _commit_all(root)
            (root / ".codecityignore").write_text("!.git\n")
            m = _final_manifest(str(root))
            names = [n["name"] for n in _walk_dirs(m["tree"])]
            self.assertNotIn(".git", names)

    def test_scan_tree_emits_commits_list(self):
        m = _final_manifest(str(FIXTURE), use_cache=False)
        self.assertIn("commits", m)
        self.assertIsInstance(m["commits"], list)
        self.assertGreater(len(m["commits"]), 0)
        dates = [c["date"] for c in m["commits"]]
        self.assertEqual(dates, sorted(dates))

    def test_scan_tree_rejects_non_git_root(self):
        """scan_tree must raise NotAGitRepoError on a non-git directory.
        Server enforces this at the HTTP boundary; the scanner check is
        defense-in-depth so direct callers fail fast."""
        from api.services.scan import NotAGitRepoError

        with tempfile.TemporaryDirectory() as td:
            Path(td, "a.txt").write_text("hello")
            with self.assertRaises(NotAGitRepoError):
                _final_manifest(td, use_cache=False)


class SignatureTreeTests(_CacheRedirectMixin, unittest.TestCase):
    """signature_tree() must produce the same digest as scan_tree() does
    for the same root — that's the contract the live-update poll relies
    on. Drift here means every poll triggers a full reload."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_signature_matches_scan_tree(self):
        m = _final_manifest(str(FIXTURE))
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
            subprocess.check_call(
                ["git", "-C", str(FIXTURE), "add", str(new_file.name)]
            )
            after_add = signature_tree(str(FIXTURE))["signature"]
            self.assertNotEqual(before, after_add)
        finally:
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "HEAD", new_file.name],
                check=False,
                capture_output=True,
            )
            new_file.unlink(missing_ok=True)

    def test_signature_honors_codecityignore(self):
        # Parity contract: editing .codecityignore must shift the
        # signature returned by signature_tree (so the live-update poll
        # actually triggers a reload), and that signature must match
        # scan_tree's output for the same root.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _init_repo(root)
            target = root / "sig-noise-fixture"
            target.mkdir()
            (target / "x.txt").write_text("x")
            _commit_all(root)
            ignore_file = root / ".codecityignore"

            # Without ignore file, target is visible.
            before_sig = signature_tree(str(root))["signature"]
            before_full = _final_manifest(str(root))["signature"]
            self.assertEqual(before_sig, before_full)

            # Add ignore entry, both signatures must shift in lockstep.
            ignore_file.write_text("sig-noise-fixture\n")
            after_sig = signature_tree(str(root))["signature"]
            after_full = _final_manifest(str(root))["signature"]
            self.assertEqual(after_sig, after_full)
            self.assertNotEqual(before_sig, after_sig)


class LineCountCapTests(unittest.TestCase):
    """Above ~5 MB the line counter samples and extrapolates instead of
    reading the entire file. Building height is a relative measure, so
    an order-of-magnitude estimate is fine on huge files."""

    def test_exact_count_below_threshold(self):
        from api.services.scan import _line_count

        with tempfile.NamedTemporaryFile("wb", delete=False) as fh:
            fh.write(b"line\n" * 1000)
            small = Path(fh.name)
        self.addCleanup(small.unlink, missing_ok=True)
        self.assertEqual(_line_count(small), 1000)

    def test_sample_extrapolation_above_threshold(self):
        from api.services.scan import _line_count

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


class BuildAuthorsListTests(unittest.TestCase):
    """Direct coverage for the build_authors_list helper.

    Integration coverage exists via the multi-author fixture commit, but
    that fixture doesn't exercise the email-only trailer path — the
    privacy-critical branch where a Co-authored-by trailer has no name
    (`<bot@host>`). These cases pin the contract: the public authors
    list never contains an `@` or domain, per CommitEntry's docstring.
    """

    def test_no_trailers_returns_primary_only(self):
        from api.services.scan import build_authors_list

        self.assertEqual(build_authors_list("Alice", ""), ["Alice"])

    def test_two_name_bearing_trailers(self):
        from api.services.scan import build_authors_list

        self.assertEqual(
            build_authors_list("Alice", "Bob <b@x>\x1fCarol <c@x>"),
            ["Alice", "Bob", "Carol"],
        )

    def test_primary_dedup_against_trailer(self):
        from api.services.scan import build_authors_list

        # Primary author repeated as a Co-authored-by trailer (cherry-
        # pick artifact) is dropped — order preserves first-seen.
        self.assertEqual(
            build_authors_list("Alice", "Bob <b@x>\x1fAlice <a@x>"),
            ["Alice", "Bob"],
        )

    def test_email_only_trailer_uses_local_part(self):
        # Regression-protection for the privacy fix: an email-only
        # trailer must not leak the @domain into the authors list.
        from api.services.scan import build_authors_list

        self.assertEqual(
            build_authors_list("Alice", "<bot@example.com>"),
            ["Alice", "bot"],
        )

    def test_bracketed_value_without_at_sign_kept_verbatim(self):
        from api.services.scan import build_authors_list

        self.assertEqual(
            build_authors_list("Alice", "<just-localpart>"),
            ["Alice", "just-localpart"],
        )

    def test_empty_brackets_dropped(self):
        from api.services.scan import build_authors_list

        self.assertEqual(build_authors_list("Alice", "<>"), ["Alice"])

    def test_duplicate_co_author_deduped(self):
        from api.services.scan import build_authors_list

        self.assertEqual(
            build_authors_list("Alice", "Bob <b@x>\x1fBob <b@x>"),
            ["Alice", "Bob"],
        )


class GitMetadataParallelTests(_CacheRedirectMixin, unittest.TestCase):
    """The two git log walks (created + modified) are independent and
    should run concurrently."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_single_walk_invocation(self):
        # The combined --name-status walk replaces the previous two
        # parallel walks — _collect_git_metadata should now fire `git
        # log` exactly once. _collect_git_dates streams output
        # via Popen; the short auxiliary commands (rev-parse, ls-files)
        # go through subprocess.run. Wrap both so we catch git log
        # regardless of which API the implementation chose.
        from unittest.mock import patch
        from api.services.scan import _collect_git_metadata

        original_run = subprocess.run
        original_popen = subprocess.Popen
        log_calls: list[list[str]] = []

        def _record_if_git_log(args) -> None:
            # Match any invocation that runs `git ... log ...`. _run_git
            # prepends `-c safe.directory=*` (and the log path also does
            # so), so we can't assume a fixed position for "log" — just
            # check the binary name and that "log" appears as a token.
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
            patch("api.services.scan.subprocess.run", side_effect=counting_run),
            patch("api.services.scan.subprocess.Popen", side_effect=counting_popen),
        ):
            _collect_git_metadata(FIXTURE, use_cache=False)

        self.assertEqual(
            len(log_calls), 1, f"expected exactly 1 git log call, got: {log_calls}"
        )

    def test_collect_git_metadata_returns_commits_list(self):
        from api.services.scan import _collect_git_metadata

        _created, _modified, _tracked, commits = _collect_git_metadata(
            FIXTURE,
            use_cache=False,
        )
        self.assertIsInstance(commits, list)
        self.assertGreater(len(commits), 0)
        # Manifest contract: oldest-first.
        dates = [c["date"] for c in commits]
        self.assertEqual(
            dates, sorted(dates), f"commits should be oldest-first, got {dates}"
        )
        for c in commits:
            self.assertEqual(
                set(c.keys()),
                {"date", "files", "sha", "authors", "subject"},
            )
            self.assertEqual(len(c["date"]), 10)  # YYYY-MM-DD
            self.assertGreaterEqual(c["files"], 1)
            self.assertRegex(c["sha"], r"^[0-9a-f]{40}$")
            self.assertIsInstance(c["authors"], list)
            self.assertGreater(len(c["authors"]), 0)
            self.assertIsInstance(c["authors"][0], str)
            self.assertGreater(len(c["authors"][0]), 0)
            self.assertIsInstance(c["subject"], str)
            # Subject must NOT contain a newline — git %s is first line only.
            self.assertNotIn("\n", c["subject"])

    def test_collect_git_metadata_captures_second_author_and_subject_only(self):
        """The fixture's "Other Fixture Person" commit is now the
        second-to-last commit (the multi-author "feat: co-authored work"
        commit is newest). Subject must be the first line only; author
        must be the second author's name (not the bot)."""
        from api.services.scan import _collect_git_metadata

        _c, _m, _t, commits = _collect_git_metadata(
            FIXTURE,
            use_cache=False,
        )
        # commits are oldest-first; the multi-author commit is now last
        # and the Other Fixture Person commit is second-to-last.
        other = commits[-2]
        self.assertEqual(other["authors"][0], "Other Fixture Person")
        self.assertEqual(other["subject"], "docs: add CONTRIBUTORS")

    def test_co_authored_commit_returns_all_distinct_authors(self) -> None:
        """The multi-author fixture commit lists three Co-authored-by trailers
        (one email-only) plus a Signed-off-by (ignored) and a duplicate
        primary-author trailer (deduped). authors should be [primary, pair,
        reviewer, emailonly-bot] in that order — the email-only trailer is
        kept as its local-part to avoid leaking the @domain."""
        # The multi-author commit is now the newest; the scanner emits
        # oldest-first so it's last.
        events = list(scan_tree(str(FIXTURE)))
        final = next(e for e in events if e["phase"] == "manifest-complete")
        commits = final["manifest"]["commits"]
        multi = commits[-1]
        self.assertEqual(
            multi["authors"],
            [
                "Test Fixture Bot",
                "Pair Programmer",
                "Reviewer Person",
                "emailonly-bot",
            ],
        )
        # Subject of the multi-author commit (sanity check we're looking at
        # the right one).
        self.assertEqual(multi["subject"], "feat: co-authored work")

    def test_collect_git_metadata_counts_merge_files(self):
        """A merge commit's combined-diff file count must be > 0, not the
        empty count git log emits by default for merges."""
        import tempfile
        from api.services.scan import _collect_git_metadata

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
            _c, _m, _t, commits = _collect_git_metadata(
                Path(td),
                use_cache=False,
            )
            # The merge commit (latest) MUST have files >= 1.
            # commits are oldest-first, so the merge is last.
            self.assertGreaterEqual(
                commits[-1]["files"],
                1,
                f"merge commit files count should be >= 1; got {commits[-1]['files']}",
            )

    def test_collect_git_metadata_counts_clean_merge_files(self):
        """A clean (non-conflicting) merge commit must also report its
        files. With `-c`, clean merges report 0; with
        `--diff-merges=first-parent` they report the side-branch diff."""
        import tempfile
        import subprocess
        from api.services.scan import _collect_git_metadata

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
            _c, _m, _t, commits = _collect_git_metadata(
                Path(td),
                use_cache=False,
            )
            # Merge is the most recent commit (oldest-first list, so [-1]).
            # Side branch added b.txt; the merge against the first parent
            # (main, which has only a.txt) introduces b.txt — so files >= 1.
            self.assertGreaterEqual(
                commits[-1]["files"],
                1,
                f"clean merge files count should be >= 1; got {commits[-1]['files']}",
            )


class GitLogRobustnessTests(_CacheRedirectMixin, unittest.TestCase):
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
        from api.services.scan import _collect_git_metadata

        with TemporaryDirectory() as td:
            td_path = Path(td)
            _init_repo(td_path)
            (td_path / "f.txt").write_text("x\n")
            subprocess.run(["git", "-C", td, "add", "-A"], check=True)
            # Build the commit object by hand so a raw 0xe9 byte
            # (Latin-1 'é', invalid standalone UTF-8) survives into the
            # author line. Passing it via GIT_AUTHOR_NAME doesn't work —
            # git silently re-encodes env strings to valid UTF-8.
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

            # Run in a thread with a deadline so a regression that
            # deadlocks the finally clause fails loudly instead of
            # hanging the pytest worker forever.
            import threading

            result: dict[str, object] = {}

            def go() -> None:
                try:
                    _c, _m, _t, commits = _collect_git_metadata(
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
                f"scan raised on non-UTF-8 metadata: {result.get('error')!r}",
            )
            commits = result["commits"]
            assert isinstance(commits, list)
            self.assertEqual(len(commits), 1)
            author = commits[0]["authors"][0]
            self.assertIn("Fran", author)
            self.assertIn("ois", author)

    def test_parse_loop_exception_kills_subprocess_before_waiting(self):
        """Failure mode B: when the parse loop raises, cleanup must
        ``proc.kill()`` before ``proc.wait()``. Otherwise wait() blocks
        forever on any git child that still has buffered output."""
        from unittest.mock import patch
        from api.services.scan import _collect_git_dates

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
        with patch("api.services.scan.subprocess.Popen", return_value=fake):
            with self.assertRaises(UnicodeDecodeError):
                _collect_git_dates(Path("/tmp/does-not-matter"))
        self.assertTrue(fake.killed, "cleanup must call proc.kill()")
        self.assertTrue(fake.waited, "cleanup must call proc.wait() after kill")


class GitHistoryCacheTests(_CacheRedirectMixin, unittest.TestCase):
    """When HEAD hasn't moved, _collect_git_metadata should hit the
    persistent cache and skip the two `git log` walks entirely."""

    @classmethod
    def setUpClass(cls):
        _ensure_fixture()

    def test_warm_run_skips_git_log(self):
        from unittest.mock import patch
        from api.services.scan import _collect_git_metadata

        # Cold run: populates cache.
        _collect_git_metadata(FIXTURE, use_cache=True)

        original_run = subprocess.run
        log_calls: list[list[str]] = []

        def counting_run(args, **kwargs):
            if isinstance(args, list) and "log" in args:
                log_calls.append(list(args))
            return original_run(args, **kwargs)

        # Warm run: must not invoke `git log` at all.
        with patch("api.services.scan.subprocess.run", side_effect=counting_run):
            _collect_git_metadata(FIXTURE, use_cache=True)
        self.assertEqual(log_calls, [], "expected zero git log calls on warm run")

    def test_use_cache_false_bypasses(self):
        from unittest.mock import patch
        from api.services.scan import _collect_git_metadata

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

        with (
            patch("api.services.scan.subprocess.run", side_effect=counting_run),
            patch("api.services.scan.subprocess.Popen", side_effect=counting_popen),
        ):
            _collect_git_metadata(FIXTURE, use_cache=False)
        self.assertEqual(
            len(log_calls), 1, "use_cache=False must run the combined log walk"
        )

    def test_cache_invalidated_after_new_commit(self):
        # Make a commit, confirm next call re-walks history.
        from unittest.mock import patch
        from api.services.scan import _collect_git_metadata

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

            with (
                patch("api.services.scan.subprocess.run", side_effect=counting_run),
                patch("api.services.scan.subprocess.Popen", side_effect=counting_popen),
            ):
                _collect_git_metadata(FIXTURE, use_cache=True)
            self.assertEqual(len(log_calls), 1, "HEAD moved -> must re-walk")
        finally:
            # Reset fixture: undo the commit and remove the file.
            subprocess.run(
                ["git", "-C", str(FIXTURE), "reset", "--hard", "HEAD~1"],
                check=False,
                capture_output=True,
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

        _final_manifest(str(FIXTURE))  # cold: populates cache

        with (
            patch("api.services.scan._line_count") as line_mock,
            patch("api.services.scan._is_binary") as binary_mock,
        ):
            _final_manifest(str(FIXTURE))  # warm: should not call either
            self.assertEqual(
                line_mock.call_count, 0, "warm scan must not call _line_count"
            )
            self.assertEqual(
                binary_mock.call_count, 0, "warm scan must not call _is_binary"
            )

    def test_warm_run_signature_matches_cold_run(self):
        cold = _final_manifest(str(FIXTURE))
        warm = _final_manifest(str(FIXTURE))
        self.assertEqual(cold["signature"], warm["signature"])
        # And tree shape — confirm `lines` survives the cache roundtrip.
        cold_lines = {n["path"]: n["lines"] for n in _walk_files(cold["tree"])}
        warm_lines = {n["path"]: n["lines"] for n in _walk_files(warm["tree"])}
        self.assertEqual(cold_lines, warm_lines)

    def test_modified_file_recomputed(self):
        from unittest.mock import patch

        _final_manifest(str(FIXTURE))  # populate

        # Change one file's mtime by writing to it.
        target = next(
            n
            for n in _walk_files(_final_manifest(str(FIXTURE))["tree"])
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

            with patch(
                "api.services.scan._line_count", side_effect=counting_line_count
            ):
                _final_manifest(str(FIXTURE))

            # Only the modified file should be recomputed.
            self.assertEqual(len(line_calls), 1)
            self.assertEqual(line_calls[0], target_path)
        finally:
            target_path.write_text(original_text)

    def test_use_cache_false_bypasses_file_cache(self):
        from unittest.mock import patch

        _final_manifest(str(FIXTURE))  # populate cache

        with patch("api.services.scan._line_count", return_value=42) as line_mock:
            _final_manifest(str(FIXTURE), use_cache=False)
            # use_cache=False -> every file gets re-read
            self.assertGreater(line_mock.call_count, 0)


def _line_count_real():
    """Get the unwrapped _line_count for tests that want to call the
    real implementation while also mocking it."""
    from api.services.scan import _line_count

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

    def _make_file(
        self, path: str, size: int = 100, mtime: float = 1_000_000.0
    ) -> dict:
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
        tree_after = self._make_tree(
            [
                self._make_file("a.py"),
                {
                    "type": "directory",
                    "path": "sub",
                    "name": "sub",
                    "children": [self._make_file("sub/b.py")],
                },
            ]
        )
        self.assertNotEqual(
            compute_tree_signature(tree_before),
            compute_tree_signature(tree_after),
        )

    def test_deterministic_across_repeated_calls(self):
        tree = self._make_tree(
            [
                self._make_file("a.py"),
                self._make_file("b.py"),
                {
                    "type": "directory",
                    "path": "pkg",
                    "name": "pkg",
                    "children": [self._make_file("pkg/c.py")],
                },
            ]
        )
        results = {compute_tree_signature(tree) for _ in range(5)}
        self.assertEqual(
            len(results), 1, "compute_tree_signature must be deterministic"
        )

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
        from api.services.scan import scan_tree

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _init_repo(root)
            (root / "hello.py").write_text("x = 1\n")
            (root / "world.py").write_text("y = 2\n")
            _commit_all(root)
            events = list(scan_tree(td))
        self.assertEqual(len(events), 2)
        skeleton_sig = events[0]["manifest"]["tree_signature"]
        final_sig = events[1]["manifest"]["tree_signature"]
        self.assertEqual(
            skeleton_sig,
            final_sig,
            "skeleton and final manifests must carry the same tree_signature",
        )

    def test_tree_signature_stable_when_only_metadata_changes(self):
        """tree_signature must be unchanged when only file content/lines/binary
        differs — i.e., between skeleton and final phases."""
        from api.services.scan import scan_tree

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _init_repo(root)
            (root / "a.py").write_text("x = 1\n" * 100)
            _commit_all(root)
            events = list(scan_tree(td))
        skeleton = events[0]["manifest"]
        final = events[1]["manifest"]
        # Metadata-sensitive signature changes between skeleton and final.
        # tree_signature must NOT change.
        self.assertEqual(skeleton["tree_signature"], final["tree_signature"])


class ScanTreeStreamingTests(unittest.TestCase):
    def _make_tiny_repo(self, tmpdir: str) -> str:
        # Two files in a fresh git repo. scan_tree requires git.
        root = Path(tmpdir)
        _init_repo(root)
        (root / "a.py").write_text("x = 1\ny = 2\n")
        (root / "b.py").write_text("z = 3\n")
        _commit_all(root)
        return tmpdir

    def test_yields_skeleton_then_final(self) -> None:
        from api.services.scan import scan_tree

        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            events = list(scan_tree(td))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["phase"], "manifest-partial")
        self.assertEqual(events[1]["phase"], "manifest-complete")

    def test_skeleton_has_placeholder_metadata(self) -> None:
        from api.services.scan import scan_tree

        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            skeleton, _final = list(scan_tree(td))

        # Walk the tree and assert every file has placeholder lines/binary.
        def files(node):
            for child in node["children"]:
                if child["type"] == "file":
                    yield child
                else:
                    yield from files(child)

        for f in files(skeleton["manifest"]["tree"]):
            self.assertEqual(
                f["lines"], 1, f"{f['path']} should have placeholder lines=1"
            )
            self.assertFalse(
                f["binary"], f"{f['path']} should have placeholder binary=False"
            )

    def test_cancel_event_pre_set_raises_at_first_boundary(self) -> None:
        import threading
        from api.services.scan import scan_tree, ScanCancelledError

        with TemporaryDirectory() as td:
            self._make_tiny_repo(td)
            ev = threading.Event()
            ev.set()
            gen = scan_tree(td, cancel_event=ev)
            with self.assertRaises(ScanCancelledError):
                list(gen)

    def test_cancel_event_set_after_skeleton_raises_in_populate(self) -> None:
        import threading
        from api.services.scan import scan_tree, ScanCancelledError

        with TemporaryDirectory() as td:
            root = Path(td)
            _init_repo(root)
            # Make enough files that the pool has work to do AFTER the
            # skeleton emits, so the event-set-after-skeleton case
            # genuinely interrupts metadata population.
            for i in range(20):
                (root / f"f{i}.py").write_text("x = 1\n" * 50)
            _commit_all(root)
            ev = threading.Event()
            gen = scan_tree(td, cancel_event=ev)
            skeleton = next(gen)
            self.assertEqual(skeleton["phase"], "manifest-partial")
            ev.set()
            with self.assertRaises(ScanCancelledError):
                next(gen)


class MediaDimsInScanTests(_CacheRedirectMixin, unittest.TestCase):
    def test_scan_stamps_png_dimensions(self):
        import struct
        import zlib

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            _init_repo(tmp_path)
            png = tmp_path / "pic.png"

            # Minimal 50x30 PNG.
            def chunk(tag, data):
                return (
                    struct.pack(">I", len(data))
                    + tag
                    + data
                    + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
                )

            sig = b"\x89PNG\r\n\x1a\n"
            ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 50, 30, 8, 2, 0, 0, 0))
            raw = (b"\x00" + b"\xff\x00\x00" * 50) * 30
            idat = chunk(b"IDAT", zlib.compress(raw))
            iend = chunk(b"IEND", b"")
            png.write_bytes(sig + ihdr + idat + iend)
            _commit_all(tmp_path)

            manifest = _final_manifest(str(tmp_path))
            files = [c for c in manifest["tree"]["children"] if c["type"] == "file"]
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]["media_width"], 50)
            self.assertEqual(files[0]["media_height"], 30)

            # Warm path: second scan should hit the file-stat cache and
            # still stamp media_width / media_height on the node — the
            # cache-hit branch in _populate_file_metadata.
            manifest2 = _final_manifest(str(tmp_path))
            files2 = [c for c in manifest2["tree"]["children"] if c["type"] == "file"]
            self.assertEqual(len(files2), 1)
            self.assertEqual(files2[0]["media_width"], 50)
            self.assertEqual(files2[0]["media_height"], 30)

    def test_scan_omits_media_dims_for_non_media(self):
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            _init_repo(tmp_path)
            (tmp_path / "code.py").write_text("print('hi')\n")
            _commit_all(tmp_path)
            manifest = _final_manifest(str(tmp_path))
            files = [c for c in manifest["tree"]["children"] if c["type"] == "file"]
            self.assertEqual(len(files), 1)
            self.assertNotIn("media_width", files[0])
            self.assertNotIn("media_height", files[0])


def test_heartbeat_calls_progress_callback_throttled():
    """The heartbeat should fire the callback at most once per ~250ms
    even if tick() is called rapidly."""
    import time
    from unittest.mock import MagicMock
    from api.services.scan import _Heartbeat

    cb = MagicMock()
    hb = _Heartbeat(on_progress=cb)

    for _ in range(1000):
        hb.tick()

    initial_count = cb.call_count
    assert initial_count >= 1, "expected at least one callback during the rapid ticks"
    assert initial_count < 50, (
        f"expected throttling to keep count low, got {initial_count}"
    )

    time.sleep(0.3)
    hb.tick()
    assert cb.call_count > initial_count, (
        "expected a new callback after throttle window"
    )


def test_heartbeat_flush_emits_terminal_count():
    """flush() must emit the final seen count when the last tick was
    throttle-suppressed, so the UI never freezes at a stale value."""
    from unittest.mock import MagicMock
    from api.services.scan import _Heartbeat

    cb = MagicMock()
    hb = _Heartbeat(on_progress=cb)

    # Rapid ticks: throttle blocks all but the first (or first few).
    for _ in range(1000):
        hb.tick()
    ticks_before_flush = cb.call_count
    last_emitted_count_before_flush = cb.call_args.args[0]

    # The heartbeat's seen count is 1000 but the last emit was much earlier.
    assert hb.seen == 1000
    assert last_emitted_count_before_flush < 1000, (
        "throttle should have suppressed late ticks"
    )

    hb.flush()
    assert cb.call_count == ticks_before_flush + 1, "flush should emit exactly once"
    assert cb.call_args.args[0] == 1000, "flush must emit the true terminal count"

    # Flushing again with no new ticks is a no-op.
    hb.flush()
    assert cb.call_count == ticks_before_flush + 1


def test_heartbeat_flush_noop_when_already_emitted():
    """flush() must not re-emit a count that was already emitted."""
    import time
    from unittest.mock import MagicMock
    from api.services.scan import _Heartbeat

    cb = MagicMock()
    hb = _Heartbeat(on_progress=cb)

    hb.tick()
    assert cb.call_count == 1
    # Sleep past the throttle window so the next tick emits.
    time.sleep(0.3)
    hb.tick()
    assert cb.call_count == 2

    # No new ticks between the last emit and flush: should be a no-op.
    hb.flush()
    assert cb.call_count == 2


if __name__ == "__main__":
    unittest.main()
