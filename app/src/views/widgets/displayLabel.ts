// views/widgets/displayLabel.ts — Shared helper for deriving a short,
// human-friendly project label from a manifest's `display_root` value.
//
// Exported as a standalone module so coordinator.ts, main.ts, and any
// future callers share one implementation instead of duplicating the
// URL/path parsing logic.

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
 * Derive a short, human-friendly label for a repo.
 *
 * Source preference, in order:
 *   1. `displayRoot` — set by the API for git-URL-synced sources (carries
 *      an optional `@branch` suffix that is stripped before parsing).
 *   2. `remoteUrl` — `manifest.repo.remote_url` from the scanner; set for
 *      any local repo whose working tree has a remote configured, so that
 *      a local clone of github.com/foo/bar still labels as "foo/bar"
 *      instead of the on-disk basename.
 *   3. `fallbackName` — the raw tree name (basename) when no URL signal is
 *      available (e.g. a local repo with no remote).
 *
 * For any URL form (http/https/ssh) we extract "owner/repo" from the last
 * two path segments. For a local-path display root we return the basename.
 */
export function labelFromDisplayRoot(
  displayRoot: string | undefined,
  remoteUrl: string | null | undefined,
  fallbackName: string
): string {
  const src = displayRoot || remoteUrl || null;
  if (!src) return fallbackName;
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
