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
