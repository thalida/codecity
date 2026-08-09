// state/stores/source.ts — Everything about *which source is loaded*: the
// current source's stable key + display info and the recently-opened list. The
// pure source-identity helpers (sourceKey/sourceIdentity/sameSourceIdentity)
// live in utils/sources; this module owns the signals and persistence built on
// them.
//
// CURRENT_SOURCE is session-scoped (set on every successful source apply);
// CURRENT_SOURCE_KEY + SOURCE_INFO derive from it (the latter also from
// MANIFEST). Persistence happens *keyed by* CURRENT_SOURCE_KEY rather than
// re-hydrating these. RECENTS is persisted — but that's an implementation
// detail of one field on the same topic, not a separate concern.

import { signal, computed, effect } from '@preact/signals';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { MAX_RECENT_SOURCES } from '@/constants/ui';
import { URL_PARAMS } from '@/constants/urlParams';
import { MANIFEST } from '@/state/stores/manifest';
import {
  srcKind,
  SourceKind,
  resolveBranch,
  identityBranch,
  sourceKey,
  sameSourceIdentity,
} from '@/utils/sources';
import { FEATURED_CITY } from '@/state/stores/ui';
import { isEmptyManifest } from '@/utils/manifest';
import type { ScanErrorCode } from '@/api/manifest';
import type { Manifest } from '@/types';

// ── Currently-loaded source ──────────────────────────────────────────

/** The applied source ({src, branch}) or null when nothing is loaded
 *  (cold boot / picker open). Single writer: the fetch hook (useManifestSource),
 *  on boot from ?src and on each successful new-source apply. */
export const CURRENT_SOURCE = signal<{ src: string; branch?: string } | null>(null);

/**
 * The last source-LOAD failure (cold-boot or user submit), or null when none.
 * A canonical fetch outcome written by useManifestSource; App reacts to it to
 * open the source picker (the hook does NOT manage the picker). App clears it
 * when the user acts on the picker (submit/close).
 */
export const SOURCE_ERROR = signal<{
  error: string;
  /** The server's machine-readable reason, where it gave one. The view keys
   *  its remedy on this rather than on the message text. */
  code?: ScanErrorCode;
  prefill?: { src: string; branch?: string };
} | null>(null);

/**
 * The source whose city is on screen right now: the project you opened, or the
 * featured repo the landing renders when you haven't opened one. Lists mark
 * their rows against this, so the same repo is marked the same way wherever it
 * is listed, which is the only way a per-repo note can mean one thing.
 */
export const ACTIVE_SOURCE = computed<{ src: string; branch?: string } | null>(() => {
  const current = CURRENT_SOURCE.value;
  if (current) return current;
  const featured = FEATURED_CITY.value;
  return featured ? { src: featured.src, branch: featured.branch } : null;
});

/**
 * The currently-loaded source's stable hash, or null when no source is loaded.
 * Derived from CURRENT_SOURCE — used to namespace per-source localStorage.
 */
export const CURRENT_SOURCE_KEY = computed<string | null>(() =>
  CURRENT_SOURCE.value ? sourceKey(CURRENT_SOURCE.value.src, CURRENT_SOURCE.value.branch) : null
);

// Reflect the applied source in the page URL so reload/share reopens it. A
// module-level effect on CURRENT_SOURCE (no imperative syncUrlToSource in the
// fetch layer). No-ops while null (cold boot / picker open) so we never clobber
// the URL before a source is applied.
effect(() => {
  const cur = CURRENT_SOURCE.value;
  if (!cur) return;
  const url = new URL(window.location.href);
  url.searchParams.set(URL_PARAMS.SRC, cur.src);
  if (cur.branch) url.searchParams.set(URL_PARAMS.BRANCH, cur.branch);
  else url.searchParams.delete(URL_PARAMS.BRANCH);
  history.replaceState(null, '', url.toString());
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

/**
 * Whether the applied source is a working tree on disk rather than a clone of a
 * remote. Only a working tree can change under the app, so anything that watches
 * for change keys off this.
 */
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
  branch?: string; // the loaded branch (remote: picked in the picker; local: checkout)
  label: string; // derived at save time: basename(src) or "owner/repo"
  lastOpenedAt: number; // ms since epoch, for MRU sort
}

/** Persisted list of recently-opened sources. Hydrates at module load. */
export const RECENTS = persistedSignal<RecentSource[]>(PERSISTED_KEYS.RECENTS, []);

export function listRecents(): RecentSource[] {
  return RECENTS.value;
}

/**
 * Push (or update) an entry. Dedupes by source identity (src, plus branch for a
 * remote — a local path is one row regardless of checkout). The pushed entry
 * becomes the most-recent. List is capped at MAX_RECENT_SOURCES (oldest dropped).
 */
export function pushRecent(entry: Omit<RecentSource, 'lastOpenedAt'>): void {
  const now = Date.now();
  const filtered = RECENTS.value.filter((r) => !sameSourceIdentity(r, entry));
  filtered.unshift({ ...entry, lastOpenedAt: now });
  RECENTS.value = filtered.slice(0, MAX_RECENT_SOURCES);
}

/**
 * Commit a successfully-loaded source: set CURRENT_SOURCE (the canonical
 * applied-source signal that the URL, CURRENT_SOURCE_KEY, SOURCE_INFO, and the
 * render layer's camera-reset all derive from) AND record it in recents with
 * the manifest-resolved branch. Single commit point for boot + switch.
 */
export function setCurrentSource(
  src: string,
  branch: string | undefined,
  manifest: Manifest
): void {
  // A local source carries no branch (identityBranch): its checkout is dynamic,
  // so CURRENT_SOURCE, the URL, the cache key, and the recent all omit it. The
  // checked-out branch is still shown in the header via SOURCE_INFO, which reads
  // it from the manifest — display only, not identity.
  const idBranch = identityBranch(src, branch);
  CURRENT_SOURCE.value = { src, branch: idBranch };
  pushRecent({
    src,
    // The server bakes the canonical owner/repo name into tree.name (a local
    // worktree's src basename would be the folder name, not the repo); keep the
    // raw src only as a defensive fallback.
    label: manifest.tree?.name || src,
    branch: identityBranch(src, resolveBranch(manifest, branch)),
  });
}

/** Drop the entry matching the given source identity. No-op if not present. */
export function removeRecent(src: string, branch?: string): void {
  RECENTS.value = RECENTS.value.filter((r) => !sameSourceIdentity(r, { src, branch }));
}
