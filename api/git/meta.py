"""Repo-level git metadata: the history walk, the working-tree snapshot, and
the footer fields for a reconstructed ref.

Complements objects.py, which reads the object database."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import NamedTuple

from api.cache import cache_load_git_history, cache_save_git_history
from api.git.cmd import git_argv, run_git
from api.models.manifest import CommitEntry, RepoInfo
from api.core.progress import log
from api.utils.dates import to_utc_iso


def is_git_repo(root: Path) -> bool:
    return run_git(root, "rev-parse", "--git-dir").strip() != ""


# ── Commit history ───────────────────────────────────────────────────────────


_NAME_EMAIL = re.compile(r"^\s*(.*?)\s*<([^>]*)>\s*$")


def build_authors_list(primary: str, trailers_raw: str) -> list[str]:
    """Primary author + Co-authored-by trailers, deduped, primary first.

    ``trailers_raw`` is git's ``valueonly`` trailer output: "Name <email>"
    entries joined by \\x1f. Dedup is on name only, matching the primary
    author format and `colorForAuthor` keying. An email-only trailer
    (``<bot@host>``) contributes just its local-part, so no address reaches
    the public authors field."""
    seen = {primary}
    out: list[str] = [primary]
    if not trailers_raw:
        return out
    for raw in trailers_raw.split("\x1f"):
        m = _NAME_EMAIL.match(raw)
        if m:
            name = m.group(1).strip() or m.group(2).strip().split("@", 1)[0]
        else:
            name = raw.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


class GitHistory(NamedTuple):
    """One history walk, indexed three ways.

    - ``created[path]``  — most recent ``A``-event; absent if never added.
    - ``modified[path]`` — most recent commit touching it; absent if untouched.
    - ``commits``        — oldest-first, so index == age rank."""

    created: dict[str, str]
    modified: dict[str, str]
    commits: list[CommitEntry]


def _walk_git_log(root: Path, ref: str | None) -> GitHistory:
    """One newest→oldest ``--name-status`` pass filling both date maps and the
    commit list.

    Newest-first with first-sighting-wins is what makes a single pass enough.
    ``--no-renames`` records a rename as delete+add, so ``created`` is when the
    *current path* appeared — the right semantic for an age signal, since the
    user sees a building for a path, not for a file identity."""
    log("  starting git log walk (full history)…")
    log_argv = git_argv(
        root,
        "log",
        "--format=COMMIT:%aI%x09%P%x09%H%x09%an%x09"
        "%(trailers:key=Co-authored-by,valueonly,separator=%x1f)"
        "%x09%s",
        "--name-status",
        "--no-renames",
        # Diff merges so a merge still reports a file count; its A/M events are
        # skipped below.
        "--diff-merges=first-parent",
    )
    if ref is not None:
        log_argv.append(ref)  # a resolved sha; limits the walk to its ancestors
    try:
        proc = subprocess.Popen(
            log_argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            # Old commits (torvalds/linux) carry Latin-1 author bytes. Strict
            # decoding would raise mid-stream and deadlock the finally below.
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except FileNotFoundError:
        return GitHistory({}, {}, [])

    created: dict[str, str] = {}
    modified: dict[str, str] = {}
    commits_newest_first: list[CommitEntry] = []
    current_date = ""
    current_is_merge = False
    current_sha = ""
    current_author = ""
    current_trailers = ""
    current_subject = ""
    current_files = 0
    commits = 0

    def flush_current() -> None:
        commits_newest_first.append(
            CommitEntry(
                date=current_date,
                files=current_files,
                sha=current_sha,
                authors=build_authors_list(current_author, current_trailers),
                subject=current_subject,
                # Overwritten by annotate_same_day_totals at manifest-wrap,
                # which always runs before a commit list is emitted. Zero is
                # the "not counted yet" value, never a shipped one.
                same_day_total=0,
            )
        )

    assert proc.stdout is not None
    # Kill before wait: if git is mid-write with a full stdout pipe, wait()
    # alone deadlocks because git can't exit until the pipe drains.
    try:
        for line in proc.stdout:
            line = line.rstrip("\n")
            if not line:
                continue
            if line.startswith("COMMIT:"):
                if current_date:
                    flush_current()
                # maxsplit=5 keeps tabs in the subject. %P is space-separated.
                parts = line[len("COMMIT:") :].split("\t", 5)
                current_date = to_utc_iso(parts[0])
                current_is_merge = " " in (parts[1] if len(parts) > 1 else "")
                current_sha = parts[2] if len(parts) > 2 else ""
                current_author = parts[3] if len(parts) > 3 else ""
                current_trailers = parts[4] if len(parts) > 4 else ""
                current_subject = parts[5] if len(parts) > 5 else ""
                current_files = 0
                commits += 1
                if commits % 25_000 == 0:
                    log(
                        f"  walked {commits:,} commits, "
                        f"{len(modified):,} files seen so far…"
                    )
                continue
            # `<status>\t<path>`; --no-renames means R/C never appear.
            tab_idx = line.find("\t")
            if tab_idx == -1:
                continue
            status = line[:tab_idx]
            path = line[tab_idx + 1 :]
            current_files += 1
            # A subtree merge re-adds its files; don't let the merge date
            # overwrite each file's real creation/modification.
            if current_is_merge:
                continue
            if path not in modified:
                modified[path] = current_date
            if status.startswith("A") and path not in created:
                created[path] = current_date
        if current_date:  # the loop ends after a block, not after a COMMIT line
            flush_current()
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    log(
        f"  done — {commits:,} commits in window, "
        f"{len(modified):,} files touched, "
        f"{len(created):,} with creation event"
    )
    return GitHistory(created, modified, list(reversed(commits_newest_first)))


def collect_git_history(
    root: Path,
    *,
    use_cache: bool = True,
    ref: str | None = None,
) -> GitHistory:
    """The history walk, memoized on the commit it starts from.

    ``ref`` must already be a resolved sha, so the cache keys on it directly
    instead of re-resolving HEAD."""
    key_sha = ref if ref is not None else run_git(root, "rev-parse", "HEAD").strip()
    if use_cache and key_sha:
        cached = cache_load_git_history(root, key_sha)
        if cached is not None:
            return GitHistory(*cached)

    log("  collecting creation + modified dates…")
    history = _walk_git_log(root, ref)
    log(
        f"    {len(history.created)} created, {len(history.modified)} modified, "
        f"{len(history.commits)} commits"
    )

    # Always write: use_cache gates the READ, so a skip-cache scan still leaves
    # the cache fresh. A failed write must never block a scan.
    if key_sha:
        try:
            cache_save_git_history(root, key_sha, *history)
        except OSError:
            pass

    return history


# ── Working-tree state ───────────────────────────────────────────────────────


def _normalize_remote_to_web_url(remote: str) -> str:
    """SSH or HTTPS remote → browseable URL; "" if it doesn't parse (the footer
    then renders no link)."""
    if not remote:
        return ""
    s = remote.strip()
    if s.startswith("git@") and ":" in s:
        host, _, path = s[len("git@") :].partition(":")
        if not host or not path:
            return ""
        s = f"https://{host}/{path}"
    if s.endswith(".git"):
        s = s[: -len(".git")]
    if not (s.startswith("http://") or s.startswith("https://")):
        return ""
    return s


def parse_dirty_paths(porcelain_z: str) -> set[str]:
    """Tracked paths differing from HEAD, from ``status --porcelain -z``.
    Untracked (??) and ignored (!!) are excluded; for a rename/copy the
    destination is dirty and the following NUL field (the source) is skipped."""
    fields = [f for f in porcelain_z.split("\0") if f]
    dirty: set[str] = set()
    i = 0
    while i < len(fields):
        entry = fields[i]
        i += 1
        status, path = entry[:2], entry[3:]
        if status in ("??", "!!"):
            continue
        if "R" in status or "C" in status:
            i += 1
        if path:
            dirty.add(path)
    return dirty


def empty_repo_info() -> RepoInfo:
    """A footer with nothing to report: no branch, no remote, no HEAD, clean.

    Every field of RepoInfo is nullable precisely for this case, so the shape
    is written once here — it is both what _collect_repo_info fills in and what
    the timeline ships for a history with no commits to describe."""
    return RepoInfo(
        branch=None,
        remote_url=None,
        head_sha=None,
        head_subject=None,
        dirty=False,
    )


def _collect_repo_info(root: Path) -> tuple[RepoInfo, set[str]]:
    """The manifest's `repo` field plus the dirty-path set.

    The porcelain status dominates on a large dirty tree, so it runs once here
    and both results are returned together — `repo.dirty` is just
    `bool(dirty_paths)`."""
    info = empty_repo_info()

    branch = run_git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch and branch != "HEAD":
        info.branch = branch
    elif branch == "HEAD":
        short = run_git(root, "rev-parse", "--short", "HEAD").strip()
        info.branch = f"detached @ {short}" if short else "detached HEAD"
    else:
        # Unborn HEAD: no commits yet, but HEAD still resolves symbolically to
        # the configured default branch, which beats showing "detached HEAD".
        symref = run_git(root, "symbolic-ref", "--short", "HEAD").strip()
        if symref:
            info.branch = symref

    remote = run_git(root, "config", "--get", "remote.origin.url").strip()
    info.remote_url = _normalize_remote_to_web_url(remote) or None

    head_line = run_git(root, "log", "-1", "--format=%h%x09%s").strip()
    if head_line:
        sha, _, subject = head_line.partition("\t")
        info.head_sha = sha or None
        info.head_subject = subject or None

    dirty_paths = parse_dirty_paths(run_git(root, "status", "--porcelain", "-z"))
    info.dirty = bool(dirty_paths)

    return info, dirty_paths


def _tracked_set(root: Path) -> set[str]:
    """Tracked files plus every parent directory, so a walk can test a
    directory the same way it tests a file."""
    tracked: set[str] = set()
    for line in run_git(root, "ls-files").splitlines():
        if not line:
            continue
        tracked.add(line)
        parts = line.split("/")
        for i in range(1, len(parts)):
            tracked.add("/".join(parts[:i]))
    return tracked


class GitState(NamedTuple):
    """Footer fields, tracked paths, dirty paths. Never cached — all three
    change without HEAD moving."""

    repo: RepoInfo
    tracked: set[str]
    dirty: set[str]


def collect_git_state(root: Path) -> GitState:
    repo, dirty = _collect_repo_info(root)
    return GitState(repo=repo, tracked=_tracked_set(root), dirty=dirty)


def reconstructed_repo_info(root: Path, commit_sha: str) -> RepoInfo:
    """Footer for a detached ref: the branch shows the short ref, and dirty is
    always False since a committed tree can't be dirty."""
    subject = run_git(root, "log", "-1", "--format=%s", commit_sha).strip()
    remote = run_git(root, "config", "--get", "remote.origin.url").strip()
    return RepoInfo(
        branch=f"@ {commit_sha[:8]}",
        remote_url=_normalize_remote_to_web_url(remote) or None,
        head_sha=commit_sha[:8],
        head_subject=subject or None,
        dirty=False,
    )
