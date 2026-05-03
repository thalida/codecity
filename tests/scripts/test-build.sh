#!/usr/bin/env bash
# test-build.sh — CLI integration tests for src/scripts/build.py
#
# Invokes build.py as a subprocess with a fabricated template + manifest,
# then asserts the output HTML has both placeholders replaced and
# surrounding content is preserved.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_PY="$REPO_ROOT/src/scripts/build.py"

PASS=0; FAIL=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✓ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✗ $desc (expected: $expected, got: $actual)"; FAIL=$((FAIL + 1))
  fi
}

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

[ -f "$BUILD_PY" ] || { echo "ERROR: $BUILD_PY not found" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 required" >&2; exit 1; }

# Silence build progress logs during tests.
export CODECITY_QUIET=1

_run_build() {
  python3 "$BUILD_PY" \
    --project "$1" --manifest "$2" --template "$3" --output "$4"
}

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# ── Inputs ────────────────────────────────────────────────────────────────────
TEMPLATE="$TMPDIR/template.html"
MANIFEST_FILE="$TMPDIR/manifest.json"
OUTPUT="$TMPDIR/out.html"

cat > "$TEMPLATE" <<'EOF'
<!DOCTYPE html>
<html><head><title>CodeCity — __PROJECT_NAME__</title></head>
<body>
  <canvas id="city"></canvas>
  <script type="application/json" id="codecity-manifest">__MANIFEST__</script>
</body></html>
EOF

echo '{"root":"test","tree":{"name":"test","children":[]}}' > "$MANIFEST_FILE"

# ── Happy path ────────────────────────────────────────────────────────────────
echo ""
echo "build.py: happy path"

_run_build "MyProject" "$MANIFEST_FILE" "$TEMPLATE" "$OUTPUT"
OUT=$(cat "$OUTPUT")

assert_contains     "project name substituted" "$OUT" "CodeCity — MyProject"
assert_contains     "canvas id preserved"      "$OUT" 'id="city"'
assert_contains     "manifest embedded"        "$OUT" '"root":"test"'
assert_not_contains "no stray __PROJECT_NAME__" "$OUT" '__PROJECT_NAME__'
assert_not_contains "no stray __MANIFEST__"    "$OUT" '__MANIFEST__'

# ── Script tag wrappers preserved ─────────────────────────────────────────────
echo ""
echo "build.py: script tag wrappers"

assert_contains "codecity-manifest script tag open"  "$OUT" '<script type="application/json" id="codecity-manifest">'
assert_contains "codecity-manifest script tag close" "$OUT" '"root":"test","tree":{"name":"test","children":[]}}</script>'

# ── Special JSON characters survive ───────────────────────────────────────────
echo ""
echo "build.py: JSON with backslashes and ampersands"

cat > "$MANIFEST_FILE" <<'EOF'
{"root":"te\\st","tree":{"name":"a & b","children":[]}}
EOF

_run_build "p&amp" "$MANIFEST_FILE" "$TEMPLATE" "$OUTPUT"
OUT=$(cat "$OUTPUT")
assert_contains "backslash preserved" "$OUT" 'te\\st'
assert_contains "ampersand preserved" "$OUT" '"a & b"'

# ── Error paths ───────────────────────────────────────────────────────────────
echo ""
echo "build.py: error paths"

if _run_build "p" "/does/not/exist.json" "$TEMPLATE" "$OUTPUT" 2>/dev/null; then
  echo "  ✗ missing manifest should fail"; FAIL=$((FAIL + 1))
else
  echo "  ✓ missing manifest fails"; PASS=$((PASS + 1))
fi

if _run_build "p" "$MANIFEST_FILE" "/does/not/exist.html" "$OUTPUT" 2>/dev/null; then
  echo "  ✗ missing template should fail"; FAIL=$((FAIL + 1))
else
  echo "  ✓ missing template fails"; PASS=$((PASS + 1))
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
