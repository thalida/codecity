// state/stores/source.ts — which source is loaded: its key, its display info,
// and the recently-opened list. The pure identity helpers live in utils/sources;
// this owns the signals built on them. Persistence is keyed BY
// CURRENT_SOURCE_KEY rather than rehydrating it — the source is session state.

import { signal, computed, effect } from '@preact/signals';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { MAX_RECENT_SOURCES } from '@/constants/ui';
import { URL_PARAMS, VIEW_PARAMS } from '@/constants/urlParams';
import { ROUTES } from '@/constants/routes';
import { navigate, hrefFor, ROUTE_SEARCH, ROUTE_PATH } from '@/state/route';
import { MANIFEST, setManifest } from '@/state/stores/manifest';
import {
  srcKind,
  SourceKind,
  resolveBranch,
  identityBranch,
  sourceKey,
  sameSourceIdentity,
} from '@/utils/sources';
import { BACKDROP_CITY } from '@/state/stores/backdrop';
import { isEmptyManifest } from '@/utils/manifest';
import type { ScanErrorCode } from '@/api/manifest';
import type { Manifest } from '@/types';

// ── Currently-loaded source ──────────────────────────────────────────

/** The applied source, or null when none is (cold boot / picker open). Written
 *  only by commitSource below, so it means "a load succeeded". */
export const CURRENT_SOURCE = signal<{ src: string; branch?: string } | null>(null);

/** The last load failure, or null. A fetch outcome, not a UI command: App
 *  reacts by opening the picker, and clears it when the user acts. */
export const SOURCE_ERROR = signal<{
  error: string;
  /** The server's machine-readable reason, where it gave one. The view keys
   *  its remedy on this rather than on the message text. */
  code?: ScanErrorCode;
  prefill?: { src: string; branch?: string };
} | null>(null);

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
  if (!cur || isEmptyManifest(m)) {
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
