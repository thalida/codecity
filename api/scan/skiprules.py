"""What the scanner is allowed to see: the global noise list, per-project
``.codecityignore`` overrides, and the filtered directory listing every walk
is built on."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Skipped on every scan. Mostly redundant with the tracked-files filter, but
# catches noise someone committed on purpose (a vendored node_modules/, a
# lockfile) that would otherwise blow up the city.
#
# Deliberately NOT here: generic names like "dist", "build", "out" — they
# collide with real source dirs (CMake configs, audio stems, hand-written
# dist/ trees). Framework caches (.next, .nuxt) are unambiguous and stay.
# Lockfiles and vendored amalgamations (one 250k-line sqlite3.c) are
# machine-generated, and one of them dominates every height-based visual.
# Public headers (sqlite3.h, lua.h) are NOT skipped — they may be authored.
ALWAYS_SKIP: frozenset[str] = frozenset(
    {
        ".git",
        ".hg",
        ".svn",  # VCS
        "node_modules",  # JS
        ".venv",
        "venv",
        "env",
        "__pycache__",  # Python
        "target",
        ".cargo",  # Rust
        ".next",
        ".nuxt",
        ".svelte-kit",  # framework caches
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".tox",
        ".coverage",
        "htmlcov",  # test/coverage
        ".idea",
        ".vscode",  # IDE state
        ".DS_Store",  # macOS junk
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",  # JS
        "bun.lock",
        "bun.lockb",  # Bun
        "deno.lock",  # Deno
        "Cargo.lock",  # Rust
        "poetry.lock",
        "uv.lock",
        "Pipfile.lock",  # Python
        "composer.lock",  # PHP
        "Gemfile.lock",  # Ruby
        "mix.lock",  # Elixir
        "Podfile.lock",  # CocoaPods
        "flake.lock",  # Nix
        "Gopkg.lock",
        "go.sum",  # Go
        "sbom.json",  # CycloneDX / SPDX
        "sqlite3.c",
        "miniz.c",
        "lua.c",  # vendored amalgamations
    }
)


@dataclass(frozen=True, slots=True)
class SkipRules:
    """The resolved skip decision for one scan root. Travels as one value
    because every walk needs all four sets together."""

    ignore_names: frozenset[str] = frozenset()
    ignore_paths: frozenset[str] = frozenset()
    unignore_names: frozenset[str] = frozenset()
    unignore_paths: frozenset[str] = frozenset()

    @classmethod
    def load(
        cls,
        root: Path,
        *,
        extra_exclude_paths: frozenset[str] = frozenset(),
    ) -> "SkipRules":
        """Read ``<root>/.codecityignore``, folding in UI-supplied excludes.

        A line without '/' matches that name anywhere in the tree; a line with
        '/' is a path anchored to the root. A leading ``!`` un-ignores, which
        is the only way to override ALWAYS_SKIP. Comments (#), blank lines, and
        surrounding whitespace/slashes are stripped. The file is optional.

        Excludes join ``ignore_paths`` so they can't resurrect a default skip.
        """
        names: set[str] = set()
        paths: set[str] = set(extra_exclude_paths)
        unignore_names: set[str] = set()
        unignore_paths: set[str] = set()
        try:
            text = (root / ".codecityignore").read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            text = ""
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            negate = line.startswith("!")
            if negate:
                line = line[1:]
            line = line.removeprefix("/").removesuffix("/")
            if not line:
                continue
            target_names = unignore_names if negate else names
            target_paths = unignore_paths if negate else paths
            if "/" in line:
                target_paths.add(line)
            else:
                target_names.add(line)
        return cls(
            ignore_names=frozenset(names),
            ignore_paths=frozenset(paths),
            unignore_names=frozenset(unignore_names),
            unignore_paths=frozenset(unignore_paths),
        )

    def skips(self, name: str, rel_path: str) -> bool:
        """First match wins: .git, then negations, then the ignore lists.

        .git is unconditional — walking the object database is never useful,
        so ``!.git`` is silently ignored."""
        if name == ".git":
            return True
        if name in self.unignore_names or rel_path in self.unignore_paths:
            return False
        return (
            name in ALWAYS_SKIP
            or name in self.ignore_names
            or rel_path in self.ignore_paths
        )

    def skips_path(self, rel_path: str) -> bool:
        """``skips`` on every segment — a skipped parent hides the file. For
        paths that arrive flat (ls-tree) rather than a directory at a time."""
        parts = rel_path.split("/")
        for i in range(len(parts)):
            if self.skips(parts[i], "/".join(parts[: i + 1])):
                return True
        return False


def tracked_entries(
    abs_dir: str,
    rel_dir: str,
    *,
    tracked: set[str],
    rules: SkipRules,
) -> list[tuple[os.DirEntry[str], str]]:
    """Survivors of one directory, each paired with its repo-relative path.

    The single source of 'which entries, in what order' — the tree build and
    the signature walk share it, which is what keeps their hashes identical."""
    try:
        entries = sorted(os.scandir(abs_dir), key=lambda e: e.name)
    except OSError:
        return []
    out: list[tuple[os.DirEntry[str], str]] = []
    for entry in entries:
        entry_rel = entry.name if rel_dir == "." else f"{rel_dir}/{entry.name}"
        if rules.skips(entry.name, entry_rel) or entry_rel not in tracked:
            continue
        out.append((entry, entry_rel))
    return out
