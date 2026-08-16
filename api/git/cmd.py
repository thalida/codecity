"""How codecity invokes git against a repo on disk.

Every read of a local repo goes through here, so the ``safe.directory`` bypass
and the ``-C <root>`` targeting are decided once. Four call sites used to
rebuild this prefix by hand, and one of them was in a router.

Talking to a REMOTE is a different job with different needs (credential
prompts disabled, no ``-C``, streamed progress) and lives in clone.py.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def git_argv(root: Path, *args: str) -> list[str]:
    """The argv for a git command against ``root``.

    ``safe.directory=*`` because codecity scans arbitrary repos, including ones
    whose owner isn't the process uid (bind-mounted CI workspaces, a container
    reading a host mount). Git 2.35+ otherwise refuses with "dubious ownership",
    and the empty stdout surfaces downstream as a manifest with 0 files and 0
    commits rather than as an error.

    Callers that interpolate a ref add ``--end-of-options`` themselves.
    """
    return ["git", "-c", "safe.directory=*", "-C", str(root), *args]


def run_git(root: Path, *args: str) -> str:
    """Run a git command against ``root`` and return stdout, or "" on any
    failure — a missing git binary, a bad ref, a non-repo.

    Callers treat empty as "no answer" rather than branching on an exit code:
    every use here is a query whose absence is already a meaningful result.
    """
    try:
        return subprocess.run(
            git_argv(root, *args),
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except FileNotFoundError:
        return ""
