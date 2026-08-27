// state/stores/source.ts — which repo: the one you opened, the ones before it,
// the folders you hid inside it, and the one merely showing behind the landing.
// The excludes are here rather than in settings/ because useManifestSource
// sends them in the manifest URL beside src and branch.

import { signal, computed, effect, type ReadonlySignal } from '@preact/signals';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { MAX_RECENT_SOURCES } from '@/constants/ui';
import { VIEW_PARAMS } from '@/router/params';
import { ROUTES } from '@/router/paths';
import { navigate, hrefFor, ROUTE_SEARCH, ROUTE_PATH } from '@/router/location';
import { MANIFEST, setManifest } from '@/state/stores/manifest';
import {
  srcKind,
  SourceKind,
  resolveBranch,
  identityBranch,
  sourceKey,
  sameSourceIdentity,
} from '@/utils/sources';
import { URL_PARAMS } from '@codecity/city';
import type { Manifest } from '@codecity/city';
import type { SourceError } from '@/types/ui';

// ── Currently-loaded source ──────────────────────────────────────────

/** The applied source, or null when none is (cold boot / picker open). Written
 *  only by commitSource below, so it means "a load succeeded". */
export const CURRENT_SOURCE = signal<{ src: string; branch?: string } | null>(null);

/** The last load failure, or null. A fetch outcome, not a UI command: App
 *  reacts by opening the picker, and clears it when the user acts. */
export const SOURCE_ERROR = signal<SourceError | null>(null);

/** What is on screen: the project you opened, or the featured repo the landing
 *  renders. Lists mark rows against this, so one repo marks the same way. */
export const ACTIVE_SOURCE = computed<{ src: string; branch?: string } | null>(() => {
  const current = CURRENT_SOURCE.value;
  if (current) return current;
  const backdrop = BACKDROP_CITY.value;
  return backdrop ? { src: backdrop.src, branch: backdrop.branch } : null;
});

/** The loaded source's stable hash, or null. Namespaces per-source storage. */
export const CURRENT_SOURCE_KEY = computed<string | null>(() =>
  CURRENT_SOURCE.value ? sourceKey(CURRENT_SOURCE.value.src, CURRENT_SOURCE.value.branch) : null
);

/** Drop the load from the URL and go home: a cancel with nothing to fall back
 *  to must not leave a reload re-running what it called off. */
export function clearSourceUrl(): void {
  // Anything the app does not own (an ?utm_source, say) rides along home: only
  // the params describing the load that was called off are dropped.
  const params = new URLSearchParams(ROUTE_SEARCH.peek());
  for (const key of [...Object.values(URL_PARAMS), ...Object.values(VIEW_PARAMS)]) {
    params.delete(key);
  }
  navigate(hrefFor(ROUTES.HOME, params), { replace: true });
}

// Reflect the applied source so reload/share reopens it, moving to /city if the
// load began at home.
effect(() => {
  const cur = CURRENT_SOURCE.value;
  if (!cur) return;
  const params = new URLSearchParams(ROUTE_SEARCH.peek());
  // A different project than the URL was describing: its mode, scrub commit
  // and selection belong to the one that just left.
  const had = params.get(URL_PARAMS.SRC);
  if (
    had &&
    !sameSourceIdentity({ src: had, branch: params.get(URL_PARAMS.BRANCH) ?? undefined }, cur)
  ) {
    for (const key of Object.values(VIEW_PARAMS)) params.delete(key);
  }
  params.set(URL_PARAMS.SRC, cur.src);
  if (cur.branch) params.set(URL_PARAMS.BRANCH, cur.branch);
  else params.delete(URL_PARAMS.BRANCH);
  // From the switcher this is a place you went, so it pushes and Back returns
  // to the list; already on /city (a re-scan, a deep link) is the same place.
  const fromHome = ROUTE_PATH.peek() === ROUTES.HOME;
  navigate(hrefFor(ROUTES.CITY, params), { replace: !fromHome });
});

export interface SourceInfo {
  /** Human-readable project label (owner/repo or directory name). */
  label: string;
  /** Branch name when the loaded source is a git URL with a known branch. */
  branch: string | undefined;
  /** Original git URL when the source is a hosted git repo. */
  sourceUrl: string | undefined;
  /** Raw source as entered: the git URL for a remote, the path for a local. */
  src: string | undefined;
}

/** A working tree on disk rather than a clone. Only a working tree can change
 *  under the app, so anything watching for change keys off this. */
export const CURRENT_SOURCE_IS_LOCAL = computed<boolean>(() => {
  const cur = CURRENT_SOURCE.value;
  return cur ? srcKind(cur.src) === SourceKind.Local : false;
});

export const SOURCE_INFO = computed<SourceInfo>(() => {
  const cur = CURRENT_SOURCE.value;
  const m = MANIFEST.value;
  if (!cur || !m) {
    return { label: '', branch: undefined, sourceUrl: undefined, src: undefined };
  }
  const manifest = m as Manifest;
  return {
    label: manifest.tree?.name ?? '',
    branch: resolveBranch(manifest, cur.branch),
    sourceUrl: srcKind(cur.src) === SourceKind.Remote ? cur.src : undefined,
    src: cur.src,
  };
});

// ── Recently-opened sources (persisted) ──────────────────────────────

export interface RecentSource {
  src: string; // exactly what was typed / passed; goes into ?src=
  branch?: string; // identity; identityBranch strips it for a local source
  // Display only. The label comes from the git remote, so every worktree of one
  // repo shares it and this is all that tells those rows apart.
  checkout?: string;
  label: string; // derived at save time: basename(src) or "owner/repo"
  lastOpenedAt: number; // ms since epoch, for MRU sort
}

/** Persisted list of recently-opened sources. Hydrates at module load. */
export const RECENTS = persistedSignal<RecentSource[]>(PERSISTED_KEYS.RECENTS, []);

/** Push (or update) an entry, most-recent first. Dedupes by source identity, so
 *  a local path is one row regardless of checkout. Capped, oldest dropped. */
export function pushRecent(entry: Omit<RecentSource, 'lastOpenedAt'>): void {
  const now = Date.now();
  const filtered = RECENTS.value.filter((r) => !sameSourceIdentity(r, entry));
  filtered.unshift({ ...entry, lastOpenedAt: now });
  RECENTS.value = filtered.slice(0, MAX_RECENT_SOURCES);
}

/** Commit a loaded source: CURRENT_SOURCE, its recents entry, and the manifest
 *  the UI reads. Every mode ends its load here, with its own manifest. */
export function commitSource(src: string, branch: string | undefined, manifest: Manifest): void {
  // ONE identity for the load, used by both writes below. Deriving it twice is
  // what listed a repo twice (#185): see the test for the two rows it produced.
  const checkout = resolveBranch(manifest, branch);
  // A local source carries no branch: its checkout is dynamic, so identity omits
  // it. The header still shows it, read off the manifest — display, not identity.
  const idBranch = identityBranch(src, checkout);
  // Source before manifest: the camera-reframe reaction reads CURRENT_SOURCE at
  // apply-start, and the apply is kicked off by the manifest write.
  CURRENT_SOURCE.value = { src, branch: idBranch };
  setManifest(manifest);
  pushRecent({
    src,
    // tree.name is the canonical owner/repo; a worktree's basename is its folder.
    label: manifest.tree?.name || src,
    branch: idBranch,
    checkout,
  });
}

/** Drop the entry matching the given source identity. No-op if not present. */
export function removeRecent(src: string, branch?: string): void {
  RECENTS.value = RECENTS.value.filter((r) => !sameSourceIdentity(r, { src, branch }));
}

// ── The city behind the landing ───────────────────────────────────────

/** Which repo the backdrop came from. */
export enum BackdropKind {
  /** The most recent project, from whatever the server had cached for it. */
  Recent = 'recent',
  /** The server's featured repo. */
  Featured = 'featured',
}

export interface BackdropCity {
  src: string;
  label: string;
  /** The loaded branch, normalised like CURRENT_SOURCE's: identity includes it,
   *  so a row storing @main only matches when this carries it too. */
  branch?: string;
  kind: BackdropKind;
}

/** Written only once the backdrop has actually painted, so nothing names a repo
 *  you can't see. Null means the hero image is what's showing. */
export const BACKDROP_CITY = signal<BackdropCity | null>(null);

// ── Folders you have hidden, per repo ─────────────────────────────────

/** repo key -> sorted, de-duped rel-paths. Whole-object persistence: the keys
 *  are runtime repo hashes, so diff-vs-default would drop every write. */
export const EXCLUDES = persistedSignal<Record<string, string[]>>(
  PERSISTED_KEYS.EXCLUDES,
  {},
  { whole: true }
);

/** Repo-scoped key: src only (branch ignored) so excludes hold across branches. */
function repoKeyFor(src: string): string {
  return sourceKey(src);
}

function currentRepoKey(): string | null {
  const cur = CURRENT_SOURCE.value;
  return cur ? repoKeyFor(cur.src) : null;
}

/** The loaded repo's exclude list (empty when no source / none set). Reactive. */
export const ACTIVE_EXCLUDES: ReadonlySignal<string[]> = computed(() => {
  const key = currentRepoKey();
  return key ? (EXCLUDES.value[key] ?? []) : [];
});

/** Peek the excludes for an explicit src — for the imperative fetch layer. */
export function activeExcludePathsFor(src: string): string[] {
  return EXCLUDES.peek()[repoKeyFor(src)] ?? [];
}

/** Replace one repo's exclude list. Sorted and de-duped, and an empty list
 *  drops the slot so the store holds only repos that hide something. */
export function setExcludesFor(src: string, next: readonly string[]): void {
  const key = repoKeyFor(src);
  const sorted = [...new Set(next)].sort();
  const map = { ...EXCLUDES.peek() };
  if (sorted.length === 0) delete map[key];
  else map[key] = sorted;
  EXCLUDES.value = map;
}

function setForCurrentRepo(next: string[]): void {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return; // no source loaded: nothing to key against
  setExcludesFor(cur.src, next);
}

/** Hide `path` from the current repo's city. Sorted + de-duped. No-op if none. */
export function addExclude(path: string): void {
  setForCurrentRepo([...(EXCLUDES.peek()[currentRepoKey() ?? ''] ?? []), path]);
}

/** Restore `path` (remove from the current repo's excludes). */
export function removeExclude(path: string): void {
  setForCurrentRepo((EXCLUDES.peek()[currentRepoKey() ?? ''] ?? []).filter((p) => p !== path));
}

/** Restore everything for the current repo. */
export function clearExcludes(): void {
  setForCurrentRepo([]);
}
