// utils/sources.ts — Source URL helpers: classification (remote vs local) and
// canonicalisation (SSH → HTTPS). Repo display names are NOT derived here: the
// server computes them once (label_from_source → baked into tree.name, and a
// `label` on progress events), so the client only ever reads a server-provided
// name — there is no client-side URL→label transform.
//
// Public surface:
//   - srcKind(src)               — SourceKind (Remote | Local) discriminator.
//   - looksResolvable / looksLikePath / validateGitUrl — field classification.

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
 * The branch label to record/show for a loaded source: the explicitly requested
 * branch when given, else the manifest's resolved HEAD when it looks like a real
 * branch (the server sometimes reports a detached HEAD, "(no branch)", or names
 * with spaces — treat those as "no branch"). A requested branch always wins.
 */
export function resolveBranch(
  manifest: { repo: { branch?: string } },
  requested?: string
): string | undefined {
  const mb = manifest.repo.branch;
  const looksReal = !!mb && !/\s/.test(mb) && !mb.startsWith('(') && !mb.startsWith('detached');
  return requested ?? (looksReal ? mb : undefined);
}

/**
 * True when a source can't be loaded without first choosing a branch: a remote
 * URL with no branch specified. The picker resolves the repo's branches and
 * preselects the default, so branch choice is explicit rather than an implicit
 * "whatever main happens to be". Local sources have no branch axis (they scan
 * the working-tree checkout), so they never need one.
 */
export function srcNeedsBranch(src: string, branch?: string): boolean {
  return srcKind(src) === SourceKind.Remote && !branch;
}

/**
 * A source string worth resolving branches for: a remote URL with a scheme
 * (https://, ssh://, ...) or the scp-style host form (user@host:path). Guards
 * against firing /api/branches on every keystroke of a half-typed URL.
 */
export function looksResolvable(v: string): boolean {
  return srcKind(v) === SourceKind.Remote && (/:\/\/.+\/.+/.test(v) || /^[^@]+@[^:]+:.+/.test(v));
}

/**
 * Heuristic: the string is *clearly* a filesystem path (absolute, home-relative,
 * dot-relative, or a Windows drive), not a half-typed URL. The unified source
 * field uses this to show a path-specific error only when it's unmistakably a
 * path — so typing a URL never flickers a "local path" error before "://" lands
 * (srcKind classifies everything without "://" as Local).
 */
export function looksLikePath(v: string): boolean {
  return /^(~|\.{1,2}\/|\/|[a-zA-Z]:[\\/])/.test(v.trim());
}

/**
 * Client-side validation for a git URL: catches the common paste mistakes (a
 * web-page URL with a #anchor or ?query, spaces, or a non-URL) before any
 * network call, so the form shows one clean inline error instead of a raw git
 * failure. Empty is not an error (submit is simply disabled until something is
 * typed). Returns null when ok, else a user-facing message.
 */
export function validateGitUrl(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/\s/.test(s)) return 'Remove the spaces from the URL.';
  if (s.includes('#') || s.includes('?')) {
    return 'Use just the repository URL, without the # or ? part.';
  }
  if (!/:\/\//.test(s) && !/^[^@]+@[^:]+:/.test(s)) {
    return 'Enter a git URL, like https://github.com/owner/repo';
  }
  return null;
}
