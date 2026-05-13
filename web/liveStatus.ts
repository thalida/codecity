// liveStatus.ts — transient runtime state for the world-rebuild signal.
// Lives OUTSIDE web/config/ on purpose: these atoms are session-only
// and must NOT be persisted to localStorage. If REBUILD_STATUS were
// re-exported from the config barrel, attachPersistence(Config) would
// rehydrate `'rebuilding'` from a session that ended mid-fetch — and
// the poll's status-gated logic would then strand the footer on
// "rebuilding…" forever.
//
// Two writers, both feed the same atoms:
//   - setupLiveUpdates() in main.ts — live-poll fetch + applyManifest
//   - scheduleRebuild() in config/hotReload.ts — save-driven applyManifest
//
// LAST_UPDATED_AT is written by the coordinator on every applied
// manifest (initial paint + each successful poll that swapped state).

import { atom } from 'nanostores';

/** State of the most recent (or current) world rebuild. */
export type RebuildStatus = 'idle' | 'rebuilding' | 'error';

export const REBUILD_STATUS = atom<RebuildStatus>('idle');

/** Error message from the most recent failed rebuild; null when idle/success. */
export const LAST_REBUILD_ERROR = atom<string | null>(null);

/** Epoch millis of the most recent manifest apply (initial or via poll). */
export const LAST_UPDATED_AT = atom<number>(0);
