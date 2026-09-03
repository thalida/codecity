// city/source.ts — what a source string IS: whether it is cloned or already on
// disk, which branch it means, whether two of them are the same repo, and
// whether one is worth sending anywhere. See SOURCE.md.
//
// The city's, not a host's: every one of these is a fact about a git source,
// and a host that had to reimplement them would get a DIFFERENT answer to "are
// these the same repo" from the city it is driving.
//
// Display names are the server's; nothing here makes one.

/** Every source is a git repo; this is whether it's cloned or already on disk. */
export enum SourceKind {
  Remote = 'remote',
  Local = 'local',
}

/** Remote if it has a scheme or the scp-style `user@host:path` form. */
export function srcKind(src: string): SourceKind {
  return /:\/\//.test(src) || /^[^@]+@[^:]+:/.test(src) ? SourceKind.Remote : SourceKind.Local;
}

/** A requested branch wins; else the manifest's HEAD, if it names a real
 *  branch rather than a detached one (see SOURCE.md). */
export function resolveBranch(
  // Nullable, not optional: null is what the scanner sends for a repo with no HEAD.
  manifest: { repo: { branch?: string | null } },
  requested?: string
): string | undefined {
  const mb = manifest.repo.branch;
  const looksReal = !!mb && !/\s/.test(mb) && !mb.startsWith('(') && !mb.startsWith('detached');
  return requested ?? (looksReal ? mb : undefined);
}

/** A local source commits no branch: it scans whatever is checked out, so a
 *  stored one would be a lie. Normalized here, once (see SOURCE.md). */
export function identityBranch(src: string, branch?: string): string | undefined {
  return srcKind(src) === SourceKind.Local ? undefined : branch;
}

// ── Source identity: (src + identity branch). See SOURCE.md.

/** Two sources with the same identity string are the same source. NUL-joined:
 *  it can't appear in a path or URL, so the halves can't collide. */
export function sourceIdentity(src: string, branch?: string): string {
  return `${src}\0${branch ?? ''}`;
}

/** Local refs are branch-less, so a checkout change never splits them. */
export function sameSourceIdentity(
  a: { src: string; branch?: string },
  b: { src: string; branch?: string }
): boolean {
  return sourceIdentity(a.src, a.branch) === sourceIdentity(b.src, b.branch);
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36); // unsigned, base-36 — ~6-7 chars
}

/** A short, stable, filename-safe name for a source. What a host namespaces
 *  per-source state by (a selection, a camera pose), and what a city calls the
 *  load it is running. */
export function sourceKey(src: string, branch?: string): string {
  return djb2(sourceIdentity(src, branch));
}

/** Worth a branch lookup: a complete remote URL, not a half-typed one. */
export function looksResolvable(v: string): boolean {
  return srcKind(v) === SourceKind.Remote && (/:\/\/.+\/.+/.test(v) || /^[^@]+@[^:]+:.+/.test(v));
}

/** Unmistakably a path, not a half-typed URL: srcKind calls everything without
 *  "://" local, and a URL must not flicker a path error before it lands. */
export function looksLikePath(v: string): boolean {
  return /^(~|\.{1,2}\/|\/|[a-zA-Z]:[\\/])/.test(v.trim());
}

/** The common paste mistakes, caught before a request so the form shows one
 *  clean error instead of a raw git failure. Empty is not an error. */
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
