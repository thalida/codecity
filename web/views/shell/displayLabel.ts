// views/shell/displayLabel.ts — Shared helper for deriving a short,
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
 * Derive a short, human-friendly label from a `display_root` value and an
 * optional fallback name.
 *
 * - If `displayRoot` is provided: strip the optional `@branch` suffix, then
 *   extract "owner/repo" for git URLs (http/https/ssh) or the basename for
 *   local paths.
 * - Otherwise: return `fallbackName` as-is.
 */
export function labelFromDisplayRoot(
  displayRoot: string | undefined,
  fallbackName: string
): string {
  if (!displayRoot) return fallbackName;
  // Strip optional @branch suffix before analysing the URL/path.
  const noBranch = displayRoot.replace(/@[^@\/]+$/, '');
  // git URL: derive "owner/repo" from the last two path segments.
  if (/:\/\//.test(noBranch) || /^[^@]+@[^:]+:/.test(noBranch)) {
    const m = noBranch.match(/[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
    return noBranch;
  }
  // Local path: basename.
  const parts = noBranch.split(/[\/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : noBranch;
}
