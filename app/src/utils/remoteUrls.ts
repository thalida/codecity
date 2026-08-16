// utils/remoteUrls.ts — browse links into the git host's own web UI, built from
// the scanner's normalized remote. Best-effort: GitHub, GitLab, Bitbucket,
// Gitea, Codeberg and Forgejo share these paths, other hosts 404, and every
// caller shows the sha or path in plain text as the fallback.

/** A commit, via the `/commit/{sha}` suffix. */
export function commitUrl(remote: string, sha: string): string | null {
  if (!remote || !sha) return null;
  const trimmed = remote.endsWith('/') ? remote.slice(0, -1) : remote;
  return `${trimmed}/commit/${sha}`;
}

/** A file or directory at a ref, via `/blob/` and `/tree/`. Null without a
 *  remote, ref and path: a local repo has no remote, and the root has no path. */
export function nodeUrl(remote: string, ref: string, path: string, isDir: boolean): string | null {
  if (!remote || !ref || !path) return null;
  const trimmed = remote.endsWith('/') ? remote.slice(0, -1) : remote;
  const seg = isDir ? 'tree' : 'blob';
  const cleanPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  if (!cleanPath) return null;
  return `${trimmed}/${seg}/${encodeURIComponent(ref)}/${cleanPath}`;
}
