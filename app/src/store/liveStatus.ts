// liveStatus.ts — transient runtime state for the world-rebuild signal.
// Lives OUTSIDE app/config/ on purpose: these atoms are session-only
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

/**
 * State of the most recent (or current) world rebuild.
 *   'rebuilding' — applyManifest is constructing the city (streets,
 *                  buildings, gem).
 *   'decorating' — the city is already in the scene; the deferred
 *                  decoration pass (trees, bushes, future mesa bounds, etc.)
 *                  is still in flight. Only emitted when at least one
 *                  decoration layer is enabled.
 */
export type RebuildStatus = 'idle' | 'rebuilding' | 'decorating' | 'error';

export const REBUILD_STATUS = atom<RebuildStatus>('idle');

/** Error message from the most recent failed rebuild; null when idle/success. */
export const LAST_REBUILD_ERROR = atom<string | null>(null);

/** Epoch millis of the most recent manifest apply (initial or via poll). */
export const LAST_UPDATED_AT = atom<number>(0);

// ── Manual refresh action ────────────────────────────────────────────
// The footer's refresh button (and any future "force re-sync" UI) goes
// through this single chokepoint so the live-poll plumbing in main.ts
// stays the only place that owns fetch + applyManifest. setupLiveUpdates
// registers its `refreshFromToggle` here during boot; anything that
// wants to "act like a fresh page load" just calls refreshManifest().

let _refreshHandler: (() => Promise<void>) | null = null;

/** Register the rebuild handler. Wired in main.ts/setupLiveUpdates. */
export function setRefreshManifest(fn: () => Promise<void>): void {
  _refreshHandler = fn;
}

/**
 * Trigger a fresh manifest fetch + apply. Resolves when the rebuild
 * finishes (or immediately, when no handler has been registered yet —
 * which only happens during boot, before setupLiveUpdates runs).
 */
export async function refreshManifest(): Promise<void> {
  if (_refreshHandler) await _refreshHandler();
}
