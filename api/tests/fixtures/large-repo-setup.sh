#!/usr/bin/env bash
# large-repo-setup.sh — Builds a 15k-file synthetic git repo for manual
# performance benchmarks of scan_tree / signature_tree.
#
# WHY A SCRIPT: The fixture is way too large to commit (~50 MB even with
# tiny files). Generate locally; not in CI.
#
# USAGE:
#   bash api/tests/fixtures/large-repo-setup.sh
#
# NOTE: Benchmark recipe removed during Docker refactor — codecity no
# longer exposes a standalone scan CLI. The script still generates the
# fixture repo; benchmark against it via the HTTP /api/manifest endpoint
# or by importing api.scan in a one-off Python harness.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR/large-repo"

# Wipe any previous run.
rm -rf "$REPO_DIR"
mkdir -p "$REPO_DIR"

export GIT_AUTHOR_NAME="Bench Fixture Bot"
export GIT_AUTHOR_EMAIL="bench-bot@codecity.test"
export GIT_COMMITTER_NAME="Bench Fixture Bot"
export GIT_COMMITTER_EMAIL="bench-bot@codecity.test"

git -C "$REPO_DIR" init -q
git -C "$REPO_DIR" checkout -q -b main

echo "Generating 15,000 files across ~150 directories…"

# 150 directories × 100 files each = 15,000 files.
# File sizes sample a realistic distribution: most small, a few medium,
# rare large.
for d in $(seq 1 150); do
    dir="$REPO_DIR/pkg-$d/sub-$((d % 10))"
    mkdir -p "$dir"
    for f in $(seq 1 100); do
        path="$dir/file-$f.py"
        # Most files: 5-20 lines. ~5% medium: 200-500 lines.
        # ~0.5% large: 2000-5000 lines.
        roll=$(( (d * f) % 200 ))
        if [ "$roll" -lt 1 ]; then
            lines=$(( 2000 + (d * f) % 3000 ))
        elif [ "$roll" -lt 11 ]; then
            lines=$(( 200 + (d * f) % 300 ))
        else
            lines=$(( 5 + (d * f) % 15 ))
        fi
        printf 'def f_%d():\n    pass\n%.0s' "$((d * 100 + f))" $(seq 1 "$lines") > "$path"
    done
done

echo "Committing all files in one commit…"
git -C "$REPO_DIR" add . > /dev/null 2>&1
git -C "$REPO_DIR" commit -q -m "initial: 15000 files"

# Make 9 more commits each touching ~500 random files so the
# `git log --name-only` walks have realistic depth (10 commits total).
for c in $(seq 2 10); do
    pkg=$(( (c * 17) % 150 + 1 ))
    sub=$(( pkg % 10 ))
    dir="$REPO_DIR/pkg-$pkg/sub-$sub"
    for f in $(seq 1 100); do
        echo "# touch $c" >> "$dir/file-$f.py"
    done
    git -C "$REPO_DIR" add . > /dev/null 2>&1
    git -C "$REPO_DIR" commit -q -m "edit batch $c"
done

count=$(find "$REPO_DIR" -type f -not -path '*/.git/*' | wc -l | tr -d ' ')
echo
echo "Done: $REPO_DIR ($count files, $(du -sh "$REPO_DIR" | cut -f1))."
echo
echo "Benchmark recipe removed during Docker refactor — codecity no"
echo "longer exposes a standalone scan CLI. To benchmark, hit the running"
echo "server's /api/manifest endpoint with src=$REPO_DIR, or import"
echo "api.scan in a one-off Python harness."
