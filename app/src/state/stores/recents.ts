// state/stores/recents.ts — the repos you have opened, most recent first.
// App-wide and persisted: it outlives any one city, and two cities open at
// once both feed it.

import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { MAX_RECENT_SOURCES } from '@/constants/ui';
import { sameSourceIdentity } from '@/utils/sources';
import { effect, untracked } from '@preact/signals';
import type { CitySession } from '@/city/session/session';

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

/** Record every repo `session` opens. Attached to the city you opened and to no
 *  other: the landing's backdrop shows you a repo you never asked for. */
export function attachRecents(session: CitySession): () => void {
  return effect(() => {
    const cur = session.source.current.value;
    const info = session.source.info.value;
    if (!cur || !info.label) return;
    untracked(() =>
      pushRecent({
        src: cur.src,
        label: info.label,
        branch: cur.branch,
        // The checkout the manifest reports, which a worktree row is told apart by.
        checkout: info.branch,
      })
    );
  });
}
