// utils/sources.ts — Source URL helpers: classification (git vs local),
// canonicalisation (SSH → HTTPS), and label derivation (URL/path → human
// label, manifest → label).
//
// Public surface:
//   - srcKind(src)               — SourceKind (Git | Local) discriminator.
//   - toHttpsRepoUrl(src)        — canonical https URL from any repo URL form.
//   - repoUrlForBranch(url, ref) — forge URL pointing at a branch tree.
//   - labelFromUrl(src)          — pure URL/path → "owner/repo" or basename.
//   - labelFromManifest(m)       — manifest-aware: display_root, remote_url,
//                                  or tree.name fallback.

import type { Manifest } from '@/types/manifest';

/** What kind of thing a source string points at: a remote git URL or an
 *  on-disk local path. The string values are the wire/persisted form. */
export enum SourceKind {
  Git = 'git',
  Local = 'local',
}

/** Classify a source string as a git URL or a local path. Git URLs are
 *  recognised by either a scheme (https://, ssh://, etc.) or the
 *  scp-style `user@host:path` form. Anything else is local. */
export function srcKind(src: string): SourceKind {
  return /:\/\//.test(src) || /^[^@]+@[^:]+:/.test(src) ? SourceKind.Git : SourceKind.Local;
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
