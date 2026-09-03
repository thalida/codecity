"""The repo's display name, derived from whatever the user typed.

A pure function over a string. It lives here rather than in git/source.py, its
old home, because the scanner needs it to bake tree.name and reaching into the
git package for it dragged the whole clone-and-resolve chain along for a regex.
"""

from __future__ import annotations

import re

# "git@host:owner/repo" — the SSH form has no scheme to spot it by.
_GIT_SSH_FORM = re.compile(r"^[^@]+@[^:]+:")


def label_from_source(src: str | None) -> str | None:
    """Display label for a source string — a git URL OR a local path.

    Git URL → "owner/repo" (last two path segments, sans .git). Local path →
    its basename. An optional trailing "@branch" is stripped first.

    THE single primitive for the repo's display name: the scanner bakes
    tree.name from the git remote's URL, and the manifest route derives the
    pending progress label from the raw src. Nothing else derives a name.
    """
    if not src:
        return None
    no_branch = re.sub(r"@[^@/]+$", "", src)  # strip a trailing @branch
    if "://" in no_branch or _GIT_SSH_FORM.match(no_branch):
        m = re.search(r"[/:]([^/]+)/([^/]+?)(?:\.git)?$", no_branch)
        return f"{m.group(1)}/{m.group(2)}" if m else no_branch
    parts = [p for p in re.split(r"[/\\]", no_branch) if p]  # local path → basename
    return parts[-1] if parts else no_branch
