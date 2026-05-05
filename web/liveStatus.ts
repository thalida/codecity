// liveStatus.ts — transient runtime state for the live-update poll.
// Lives OUTSIDE web/config/ on purpose: these atoms are session-only
// and must NOT be persisted to localStorage. If IS_RELOADING were
// re-exported from the config barrel, attachPersistence(Config) would
// rehydrate `true` from a session that ended mid-fetch — and the
// poll's `if (IS_RELOADING.get()) return` guard would then strand the
// footer on "reloading…" forever.
//
// setupLiveUpdates() in main.ts is the sole writer for IS_RELOADING.
// LAST_UPDATED_AT is written by the coordinator on every applied
// manifest (initial paint + each successful poll that swapped state).

import { atom } from 'nanostores';

export const IS_RELOADING = atom<boolean>(false);

/** Epoch millis of the most recent manifest apply (initial or via poll). */
export const LAST_UPDATED_AT = atom<number>(0);
