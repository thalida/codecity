// utils/commitUrl.ts — build a browseable commit URL from the
// normalized remote URL the scanner emits + a full SHA. Uses the
// `/commit/{sha}` suffix that GitHub, GitLab, Bitbucket, Gitea,
// Codeberg, and Forgejo all share. Hosts with a different convention
// will 404, which is acceptable — the link is best-effort and the SHA
// is always shown in plain text as the fallback.

export function commitUrl(remote: string, sha: string): string | null {
  if (!remote || !sha) return null;
  const trimmed = remote.endsWith('/') ? remote.slice(0, -1) : remote;
  return `${trimmed}/commit/${sha}`;
}
