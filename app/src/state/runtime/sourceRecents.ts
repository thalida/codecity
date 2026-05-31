// state/runtime/sourceRecents.ts — recently-opened sources, backed by a
// persistedSignal. The source picker modal reads listRecents() to show
// one-click reload rows.

import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS, MAX_RECENT_SOURCES } from '@/constants';

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

/** Drop the entry matching (src, branch). No-op if not present. */
export function removeRecent(src: string, branch?: string): void {
  RECENTS.value = RECENTS.value.filter(
    (r) => !(r.src === src && (r.branch ?? '') === (branch ?? ''))
  );
}
