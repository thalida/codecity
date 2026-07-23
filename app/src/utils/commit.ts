// utils/commit.ts — Pure helper for per-commit UI: building a browseable
// commit URL from the scanner's normalized remote. Used by the commit pane.
//
// Same-day commit counts (the busyness badge) are no longer computed here —
// each CommitEntry carries a backend-baked same_day_total, and the per-day
// "Busy/Average/Quiet" thresholds come from manifest.busyness. See
// api/scan.py (_annotate_same_day_totals + _compute_busyness).

/**
 * Build a browseable commit URL from a normalized remote URL + full SHA.
 *
 * Uses the `/commit/{sha}` suffix that GitHub, GitLab, Bitbucket, Gitea,
 * Codeberg, and Forgejo all share. Hosts with a different convention
 * will 404, which is acceptable — the link is best-effort and the SHA
 * is always shown in plain text as the fallback.
 */
export function commitUrl(remote: string, sha: string): string | null {
  if (!remote || !sha) return null;
  const trimmed = remote.endsWith('/') ? remote.slice(0, -1) : remote;
  return `${trimmed}/commit/${sha}`;
}

/**
 * Build a browseable file/directory URL on the origin remote at a given ref.
 *
 * GitHub, GitLab, Gitea, Codeberg, and Forgejo all share `/blob/{ref}/{path}`
 * for files and `/tree/{ref}/{path}` for directories. Best-effort like
 * {@link commitUrl}: hosts with a different convention 404, and the path is
 * always copyable as a fallback. Returns null for an empty remote/ref/path
 * (e.g. a local repo with no remote, or the root directory).
 */
export function nodeUrl(
  remote: string,
  ref: string,
  path: string,
  isDir: boolean
): string | null {
  if (!remote || !ref || !path) return null;
  const trimmed = remote.endsWith('/') ? remote.slice(0, -1) : remote;
  const seg = isDir ? 'tree' : 'blob';
  const cleanPath = path
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  if (!cleanPath) return null;
  return `${trimmed}/${seg}/${encodeURIComponent(ref)}/${cleanPath}`;
}
