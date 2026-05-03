#!/usr/bin/env bash
# test-codecity.py — Integration test for skills/codecity/codecity.py (the
# shipped public entry). Runs it against tests/fixtures/sample-repo and
# verifies the output HTML has the expected fingerprints.
#
# Prerequisites:
#   - bash tests/fixtures/setup.sh has been run (sample-repo exists)
#   - `npm run build` has been run (skills/codecity/template.html + shipped scripts exist)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHIPPED="$REPO_ROOT/skills/codecity/codecity.py"
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 required" >&2; exit 1; }
FIXTURE="$REPO_ROOT/tests/fixtures/sample-repo"

PASS=0; FAIL=0

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "  ✓ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✗ $desc (expected to contain: $needle)"; FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qvF "$needle"; then
    echo "  ✓ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✗ $desc (expected to NOT contain: $needle)"; FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "Pre-flight"
[ -f "$SHIPPED" ] || { echo "  ERROR: $SHIPPED not found — run 'npm run build'" >&2; exit 1; }
[ -d "$FIXTURE" ] || { echo "  ERROR: $FIXTURE not found — run 'bash tests/fixtures/setup.sh'" >&2; exit 1; }
[ -f "$REPO_ROOT/skills/codecity/template.html" ] || { echo "  ERROR: template.html not found — run 'npm run build'" >&2; exit 1; }
echo "  ✓ shipped codecity.py + template + fixture present"

TMPOUT=$(mktemp -t codecity-out-XXXXXX).html
trap 'rm -f "$TMPOUT"' EXIT

# Silence progress logs during tests.
export CODECITY_QUIET=1

# ── Happy path ────────────────────────────────────────────────────────────────
echo ""
echo "codecity.py: happy path"

python3 "$SHIPPED" --root "$FIXTURE" --output "$TMPOUT" >/dev/null

[ -f "$TMPOUT" ] && [ -s "$TMPOUT" ] \
  && { echo "  ✓ output file written and non-empty"; PASS=$((PASS + 1)); } \
  || { echo "  ✗ output file missing or empty"; FAIL=$((FAIL + 1)); }

OUT=$(cat "$TMPOUT")

assert_contains     "has <canvas id=\"city\">"          "$OUT" 'id="city"'
assert_contains     "has tree sidebar container"         "$OUT" 'id="tree-sidebar"'
assert_contains     "has project name from basename"     "$OUT" 'CodeCity — sample-repo'
assert_contains     "embeds manifest script tag"         "$OUT" 'id="codecity-manifest"'
assert_contains     "manifest contains sample-repo root" "$OUT" 'sample-repo'
assert_not_contains "no unreplaced __PROJECT_NAME__"     "$OUT" '__PROJECT_NAME__'
assert_not_contains "no unreplaced __MANIFEST__"         "$OUT" '__MANIFEST__'

# ── Usage ────────────────────────────────────────────────────────────────────
echo ""
echo "codecity.py: zero-args prints usage and exits non-zero"

if python3 "$SHIPPED" >/dev/null 2>&1; then
  echo "  ✗ zero-args should exit non-zero"; FAIL=$((FAIL + 1))
else
  echo "  ✓ zero-args exits non-zero"; PASS=$((PASS + 1))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  echo "FAIL: $FAIL test(s) failed"; exit 1
fi
echo "All tests passed."
exit 0
