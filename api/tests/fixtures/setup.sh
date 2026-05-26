#!/usr/bin/env bash
# setup.sh — Builds the sample-repo test fixture deterministically.
# Run from any directory; the fixture is always created relative to this script.
#
# WHY A SCRIPT: The fixture must be a real git repo with deterministic commit
# history (specific dates, commit counts, contributors) so scanner tests can
# assert exact git metadata values. Git doesn't allow committing a .git/ dir
# inside another git repo, so we generate it.
#
# The generated tests/fixtures/sample-repo/ directory is listed in the root
# .gitignore and is NOT committed. Run this script before scanner tests.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR/sample-repo"

# ── Wipe any previous run ────────────────────────────────────────────────────
rm -rf "$REPO_DIR"
mkdir -p "$REPO_DIR"

# ── Git identity (not a real person) ─────────────────────────────────────────
export GIT_AUTHOR_NAME="Test Fixture Bot"
export GIT_AUTHOR_EMAIL="fixture-bot@codecity.test"
export GIT_COMMITTER_NAME="Test Fixture Bot"
export GIT_COMMITTER_EMAIL="fixture-bot@codecity.test"

# ── Initialise repo ─────────────────────────────────────────────────────────
git -C "$REPO_DIR" init -q
git -C "$REPO_DIR" checkout -q -b main

# ── Helper ───────────────────────────────────────────────────────────────────
write_file() {
  local path="$REPO_DIR/$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path"
}

# ═══════════════════════════════════════════════════════════════════════════════
# COMMIT 1 — Initial project scaffolding
# Date: 2024-01-10T09:00:00+00:00
# Files: .gitignore, package.json, docs/README.md
# ═══════════════════════════════════════════════════════════════════════════════

# .gitignore (3 lines)
write_file ".gitignore" <<'EOF'
node_modules/
dist/
*.log
EOF

# package.json (10 lines)
write_file "package.json" <<'EOF'
{
  "name": "sample-repo",
  "version": "1.0.0",
  "description": "Sample repository used as a test fixture.",
  "scripts": {
    "build": "tsc",
    "test": "node tests/index.test.ts"
  },
  "devDependencies": {}
}
EOF

# docs/README.md (15 lines)
write_file "docs/README.md" <<'EOF'
# Sample Repo

A minimal TypeScript project used as a deterministic test fixture for CodeCity.

## Structure

- `src/` — Application source code
- `tests/` — Unit tests
- `docs/` — Project documentation

## Getting Started

```
npm install && npm run build
```
EOF

GIT_AUTHOR_DATE="2024-01-10T09:00:00+00:00" \
GIT_COMMITTER_DATE="2024-01-10T09:00:00+00:00" \
  git -C "$REPO_DIR" add .gitignore package.json docs/
GIT_AUTHOR_DATE="2024-01-10T09:00:00+00:00" \
GIT_COMMITTER_DATE="2024-01-10T09:00:00+00:00" \
  git -C "$REPO_DIR" commit -q -m "chore: initial project scaffolding"

# ═══════════════════════════════════════════════════════════════════════════════
# COMMIT 2 — Add source files, tests, and binary asset
# Date: 2024-03-22T14:30:00+00:00
# Files: src/**, tests/**, logo.png
# ═══════════════════════════════════════════════════════════════════════════════

# src/utils.ts (20 lines) — simple utility functions, no frameworks
write_file "src/utils.ts" <<'EOF'
/**
 * Utility helpers shared across the application.
 */

/**
 * Clamps a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Returns true when the given string is non-empty after trimming.
 */
export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

EOF

# src/components/Button.ts (30 lines) — plain TS, no React
write_file "src/components/Button.ts" <<'EOF'
/**
 * Button configuration and rendering helpers.
 */

export type Variant = "primary" | "secondary" | "danger";

export interface ButtonConfig {
  label: string;
  variant: Variant;
  disabled: boolean;
}

/**
 * Creates a button configuration with sensible defaults.
 */
export function createButton(label: string, variant: Variant = "primary"): ButtonConfig {
  return { label, variant, disabled: false };
}

/**
 * Returns the CSS class string for a given button configuration.
 */
export function getButtonClass(config: ButtonConfig): string {
  const base = `btn btn--${config.variant}`;
  return config.disabled ? `${base} btn--disabled` : base;
}

export function isDisabled(config: ButtonConfig): boolean {
  return config.disabled;
}
EOF

# src/components/Header.ts (80 lines) — plain TS, no React
write_file "src/components/Header.ts" <<'EOF'
/**
 * Header configuration and layout helpers.
 */

export interface NavItem {
  label: string;
  href: string;
}

export interface HeaderConfig {
  title: string;
  navItems: NavItem[];
  isLoggedIn: boolean;
  menuOpen: boolean;
}

/**
 * Creates a header configuration with sensible defaults.
 */
export function createHeader(title: string, navItems: NavItem[] = []): HeaderConfig {
  return {
    title,
    navItems,
    isLoggedIn: false,
    menuOpen: false,
  };
}

/**
 * Toggles the mobile menu open/closed state.
 */
export function toggleMenu(config: HeaderConfig): HeaderConfig {
  return { ...config, menuOpen: !config.menuOpen };
}

/**
 * Sets the login state on the header.
 */
export function setLoggedIn(config: HeaderConfig, loggedIn: boolean): HeaderConfig {
  return { ...config, isLoggedIn: loggedIn };
}

/**
 * Returns the label for the auth button.
 */
export function getAuthLabel(config: HeaderConfig): string {
  return config.isLoggedIn ? "Log out" : "Log in";
}

/**
 * Returns the variant for the auth button.
 */
export function getAuthVariant(config: HeaderConfig): string {
  return config.isLoggedIn ? "secondary" : "primary";
}

/**
 * Adds a navigation item to the header.
 */
export function addNavItem(config: HeaderConfig, item: NavItem): HeaderConfig {
  return { ...config, navItems: [...config.navItems, item] };
}

/**
 * Removes a navigation item by href.
 */
export function removeNavItem(config: HeaderConfig, href: string): HeaderConfig {
  return {
    ...config,
    navItems: config.navItems.filter((item) => item.href !== href),
  };
}

/**
 * Returns the CSS class for the nav.
 */
export function getNavClass(config: HeaderConfig): string {
  const base = "header__nav";
  return config.menuOpen ? `${base} header__nav--open` : base;
}
EOF

# src/index.ts (50 lines) — app entry point, plain TS
write_file "src/index.ts" <<'EOF'
/**
 * Application entry point.
 *
 * Assembles the header configuration and exposes a public API.
 */
import { createHeader, addNavItem, toggleMenu, HeaderConfig } from "./components/Header";
import { clamp, isNonEmpty } from "./utils";

const DEFAULT_NAV = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

/**
 * Initializes the application with a title and default navigation.
 */
export function init(title: string): HeaderConfig {
  let header = createHeader(title);
  for (const item of DEFAULT_NAV) {
    header = addNavItem(header, item);
  }
  return header;
}

/**
 * Reads a numeric config value, clamped to a valid range.
 */
export function readConfig(raw: string, min: number, max: number): number {
  const parsed = parseInt(raw, 10);
  const value = Number.isFinite(parsed) ? parsed : min;
  return clamp(value, min, max);
}

/**
 * Validates that a required string config value is present.
 */
export function validateRequired(value: string, name: string): void {
  if (!isNonEmpty(value)) {
    throw new Error(`Required config "${name}" is missing or empty.`);
  }
}

/**
 * Quick-start: init with defaults and toggle the menu open.
 */
export function quickStart(): HeaderConfig {
  const header = init("CodeCity");
  return toggleMenu(header);
}
EOF

# tests/index.test.ts (40 lines) — simple test assertions, no test framework
write_file "tests/index.test.ts" <<'EOF'
/**
 * Unit tests for application utilities.
 */
import { clamp, isNonEmpty } from "../src/utils";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  PASS: ${message}`);
}

// ── clamp ───────────────────────────────────────────────────────────────────

console.log("clamp:");
assert(clamp(5, 0, 10) === 5, "returns value when within range");
assert(clamp(-3, 0, 10) === 0, "returns min when below range");
assert(clamp(15, 0, 10) === 10, "returns max when above range");
assert(clamp(7, 4, 4) === 4, "handles equal min and max");
assert(clamp(0, 0, 0) === 0, "handles all zeros");
assert(clamp(10, 0, 10) === 10, "returns max when at boundary");

// ── isNonEmpty ──────────────────────────────────────────────────────────────

console.log("isNonEmpty:");
assert(isNonEmpty("hello") === true, "true for non-empty string");
assert(isNonEmpty("") === false, "false for empty string");
assert(isNonEmpty("   ") === false, "false for whitespace-only");
assert(isNonEmpty(" a ") === true, "true for padded non-empty");
assert(isNonEmpty("0") === true, "true for zero string");

// ── readConfig ──────────────────────────────────────────────────────────────

import { readConfig } from "../src/index";

console.log("readConfig:");
assert(readConfig("5", 0, 10) === 5, "parses valid number");
assert(readConfig("abc", 0, 10) === 0, "falls back to min for non-numeric");

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("\nAll tests passed.");
EOF

# logo.png — minimal valid 1×1 PNG (~67 bytes)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82' \
  > "$REPO_DIR/logo.png"

GIT_AUTHOR_DATE="2024-03-22T14:30:00+00:00" \
GIT_COMMITTER_DATE="2024-03-22T14:30:00+00:00" \
  git -C "$REPO_DIR" add src/ tests/ logo.png
GIT_AUTHOR_DATE="2024-03-22T14:30:00+00:00" \
GIT_COMMITTER_DATE="2024-03-22T14:30:00+00:00" \
  git -C "$REPO_DIR" commit -q -m "feat: add source files, tests, and logo"

# ── Summary ──────────────────────────────────────────────────────────────────
echo "sample-repo created at: $REPO_DIR"
echo ""
git -C "$REPO_DIR" log --oneline
echo ""
echo "File inventory:"
find "$REPO_DIR" -not -path '*/.git/*' -type f | sort | while read -r f; do
  lines=$(wc -l < "$f" 2>/dev/null || echo "binary")
  size=$(wc -c < "$f")
  printf "  %-55s %4s lines  %5s bytes\n" "${f#$REPO_DIR/}" "$lines" "$size"
done
