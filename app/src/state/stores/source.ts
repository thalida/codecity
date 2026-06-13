// state/stores/source.ts — Everything about *which source is loaded*: the
// current source's stable key + display info, the per-(src,branch) hash used to
// namespace per-source localStorage slots, and the recently-opened list.
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
import { srcKind, SourceKind, resolveBranch, labelFromSource } from '@/utils/sources';
import { isEmptyManifest } from '@/utils/manifest';
import type { Manifest } from '@/types';

// ── sourceKey: stable short hash of (src, branch) ────────────────────

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36); // unsigned, base-36 — ~6-7 chars
}

/**
 * Compute a short stable hash for a (src, branch) pair. Used to namespace
 * per-source state (selection, camera pose) in localStorage.
 *
 * The hash distinguishes (src, undefined) from (src, ""), but in practice
 * we treat empty-string branch as "no branch" — callers should pass undefined.
 */
export function sourceKey(src: string, branch?: string): string {
  return djb2(`${src}\0${branch ?? ''}`);
}

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
  prefill?: { src: string; branch?: string };
} | null>(null);

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

/**
 * Label of the source currently being LOADED (from the server's `display_root`),
 * or null when no load is in flight. Drives the "(pending)" document title while
 * streaming; useDocumentTitle prefers it over MANIFEST so a source switch shows
 * the new project name immediately, before its manifest lands. Cleared when the
 * stream settles (success or failure).
 */
export const PENDING_SOURCE_LABEL = signal<string | null>(null);

export interface SourceInfo {
  /** Human-readable project label (owner/repo or directory name). */
  label: string;
  /** Branch name when the loaded source is a git URL with a known branch. */
  branch: string | undefined;
  /** Original git URL when the source is a hosted git repo. */
  sourceUrl: string | undefined;
}

export const SOURCE_INFO = computed<SourceInfo>(() => {
  const cur = CURRENT_SOURCE.value;
  const m = MANIFEST.value;
  if (!cur || isEmptyManifest(m)) {
    return { label: '', branch: undefined, sourceUrl: undefined };
  }
  const manifest = m as Manifest;
  return {
    label: manifest.tree?.name ?? '',
    branch: resolveBranch(manifest, cur.branch).branch,
    sourceUrl: srcKind(cur.src) === SourceKind.Remote ? cur.src : undefined,
  };
});

// ── Recently-opened sources (persisted) ──────────────────────────────

export interface RecentSource {
  src: string; // exactly what was typed / passed; goes into ?src=
  branch?: string; // only meaningful for git URLs
  /** True when `branch` was filled in from the manifest's resolved
   *  HEAD (i.e. the user didn't type a branch — we recorded the
   *  repo's default). The picker annotates these rows with "(default)"
   *  so the user knows the branch was inferred, not chosen. */
  branchIsDefault?: boolean;
  label: string; // derived at save time: basename(src) or "owner/repo"
  lastOpenedAt: number; // ms since epoch, for MRU sort
}

/** Persisted list of recently-opened sources. Hydrates at module load. */
export const RECENTS = persistedSignal<RecentSource[]>(PERSISTED_KEYS.RECENTS, []);

export function listRecents(): RecentSource[] {
  return RECENTS.value;
}

/**
 * Push (or update) an entry. Dedupes by (src, branch ?? ''). The pushed
 * entry becomes the most-recent. List is capped at MAX_RECENT_SOURCES
 * entries (oldest dropped).
 *
 * Special case for `branchIsDefault`: when an entry's branch was filled
 * in from the manifest's resolved HEAD (the user didn't type one), we
 * also drop any pre-existing entry for the same src with NO branch
 * recorded. Those are the same logical project — the empty-branch row
 * was just from before we resolved the default — and keeping both
 * leaves a confusing duplicate in the picker.
 */
export function pushRecent(entry: Omit<RecentSource, 'lastOpenedAt'>): void {
  const now = Date.now();
  const filtered = RECENTS.value.filter((r) => {
    if (r.src !== entry.src) return true;
    if ((r.branch ?? '') === (entry.branch ?? '')) return false;
    if (entry.branchIsDefault && !r.branch) return false;
    return true;
  });
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
  CURRENT_SOURCE.value = { src, branch };
  const { branch: resolvedBranch, isDefault } = resolveBranch(manifest, branch);
  pushRecent({
    src,
    branch: resolvedBranch,
    branchIsDefault: isDefault,
    label: labelFromSource(src) ?? src,
  });
}

/** Drop the entry matching (src, branch). No-op if not present. */
export function removeRecent(src: string, branch?: string): void {
  RECENTS.value = RECENTS.value.filter(
    (r) => !(r.src === src && (r.branch ?? '') === (branch ?? ''))
  );
}
