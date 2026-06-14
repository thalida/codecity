// utils/sources.ts — Source URL helpers: classification (remote vs local),
// canonicalisation (SSH → HTTPS), and label derivation (URL/path → human label).
//
// Public surface:
//   - srcKind(src)               — SourceKind (Remote | Local) discriminator.
//   - toHttpsRepoUrl(src)        — canonical https URL from any repo URL form.
//   - repoUrlForBranch(url, ref) — forge URL pointing at a branch tree.
//   - labelFromSource(src)       — a git URL OR a local path → "owner/repo" or
//                                  basename, for labelling a PENDING source
//                                  before its manifest loads. The manifest's own
//                                  tree.name is normalized server-side, so there
//                                  is no manifest→label helper here.

/** What kind of thing a source string points at. Every source is a git repo;
 *  the axis is whether it's a remote URL (cloned) or an on-disk local working
 *  tree. String values are stable human-readable discriminators. */
export enum SourceKind {
  Remote = 'remote',
  Local = 'local',
}

/** Classify a source string as a remote git URL or a local path. Remote URLs
 *  are recognised by either a scheme (https://, ssh://, etc.) or the scp-style
 *  `user@host:path` form. Anything else is local. */
export function srcKind(src: string): SourceKind {
  return /:\/\//.test(src) || /^[^@]+@[^:]+:/.test(src) ? SourceKind.Remote : SourceKind.Local;
}

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
 * Append a branch-tree path to a forge HTTPS URL so a link opens the given
 * branch instead of the repo root. The path shape is forge-specific (GitHub
 * `/tree`, GitLab `/-/tree`, Gitea/Forgejo/Codeberg `/src/branch`, Bitbucket
 * `/src`); unrecognised hosts get the bare repo URL back.
 */
export function repoUrlForBranch(repoHttpsUrl: string, branch: string): string {
  const ref = encodeURIComponent(branch);
  if (/codeberg\.org|forgejo|gitea/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/src/branch/${ref}`;
  }
  if (/github\.com|sr\.ht/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/tree/${ref}`;
  }
  if (/gitlab\.com/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/-/tree/${ref}`;
  }
  if (/bitbucket\.org/i.test(repoHttpsUrl)) {
    return `${repoHttpsUrl}/src/${ref}`;
  }
  return repoHttpsUrl;
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
export function labelFromSource(src: string | null | undefined): string | null {
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
 * Resolve which branch label to show and whether it's the repo default. The
 * server sometimes reports a non-branch (detached HEAD, "(no branch)", names
 * with spaces) — treat those as "no branch". An explicitly requested branch
 * always wins and is never considered the default.
 */
export function resolveBranch(
  manifest: { repo: { branch?: string } },
  requested?: string
): { branch?: string; isDefault: boolean } {
  const mb = manifest.repo.branch;
  const looksReal = !!mb && !/\s/.test(mb) && !mb.startsWith('(') && !mb.startsWith('detached');
  return {
    branch: requested ?? (looksReal ? mb! : undefined),
    isDefault: !requested && looksReal,
  };
}
