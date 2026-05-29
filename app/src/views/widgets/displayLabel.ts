// views/widgets/displayLabel.ts — Shared helpers for deriving a short,
// human-friendly project label.
//
// Two entry points:
//   - labelFromUrl     — pure URL/path → label transform. Used by
//                        applyPendingTitle in main.ts, where we have a
//                        bare display_root string from the first stream
//                        event and NO manifest yet.
//   - labelFromManifest — manifest-aware: prefers display_root, falls
//                        back to repo.remote_url, then tree.name.
//
// Exported as a standalone module so coordinator.ts, main.ts, renderLoop.ts,
// and any future callers share one implementation instead of duplicating
// the URL/path parsing logic.

import type { Manifest } from '@/types/manifest';

/**
 * Convert any recognisable repo URL form to an https:// URL.
 *   https://… / http://… → returned as-is.
 *   git@host:path.git    → https://host/path  (SSH → HTTPS)
 *   anything else        → returned unchanged (best effort).
 */
export function toHttpsRepoUrl(src: string): string {
  if (src.startsWith('https://') || src.startsWith('http://')) return src;
  // SSH form: git@github.com:owner/repo.git
  const sshMatch = /^[^@]+@([^:]+):(.+?)(?:\.git)?$/.exec(src);
  if (sshMatch) {
    const host = sshMatch[1];
    const path = sshMatch[2];
    return `https://${host}/${path}`;
  }
  return src;
}

/**
 * Pure URL/path → label transform.
 *
 * For any URL form (http/https/ssh) we extract "owner/repo" from the last
 * two path segments. For a local-path display root we return the basename.
 * Returns null only when the input is empty/null/undefined — in that case
 * callers should fall back to whatever else they have (tree.name, etc.).
 *
 * Strips an optional `@branch` suffix the server appends for git sources
 * before parsing.
 */
export function labelFromUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  // Strip optional @branch suffix before analysing the URL/path.
  const noBranch = src.replace(/@[^@/]+$/, '');
  // git URL: derive "owner/repo" from the last two path segments.
  if (/:\/\//.test(noBranch) || /^[^@]+@[^:]+:/.test(noBranch)) {
    const m = noBranch.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
    return noBranch;
  }
  // Local path: basename.
  const parts = noBranch.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : noBranch;
}

/**
 * Derive a short, human-friendly label for a manifest.
 *
 * Source preference, in order:
 *   1. `manifest.display_root` — set by the API for git-URL-synced sources
 *      (carries an optional `@branch` suffix that is stripped before parsing).
 *   2. `manifest.repo.remote_url` — set for any local repo whose working
 *      tree has a remote configured, so that a local clone of
 *      github.com/foo/bar still labels as "foo/bar" instead of the on-disk
 *      basename.
 *   3. `manifest.tree.name` — the raw tree name (basename) when no URL signal
 *      is available (e.g. a local repo with no remote).
 */
export function labelFromManifest(m: Manifest | null | undefined): string | null {
  if (!m) return null;
  if (m.display_root) {
    const fromDisplay = labelFromUrl(m.display_root);
    if (fromDisplay) return fromDisplay;
  }
  if (m.repo?.remote_url) {
    const fromRemote = labelFromUrl(m.repo.remote_url);
    if (fromRemote) return fromRemote;
  }
  return m.tree?.name ?? null;
}
