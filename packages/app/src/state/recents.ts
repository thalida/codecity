// state/recents.ts — the projects you have opened, most recent first. Persisted,
// and cross-feature: the landing lists them, the city view adds to them.

import { signal } from '@preact/signals';
import { sameSourceIdentity } from '@codecity/city';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { MAX_RECENT_SOURCES } from '@/constants/ui';

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

/** Drop the entry matching the given source identity. No-op if not present. */
export function removeRecent(src: string, branch?: string): void {
  RECENTS.value = RECENTS.value.filter((r) => !sameSourceIdentity(r, { src, branch }));
}
