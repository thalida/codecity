// state/stores/manifest.ts — The current manifest: a canonical signal mirroring
// the scene's loaded tree, plus the world-rebuild status that drives the
// footer + loading overlay. All session-scoped (never persisted — a rehydrated
// REBUILD_STATUS would strand the footer on "rebuilding…" after a reload).
//
// The scene (world.getManifest()) is the source of truth; MANIFEST tracks
// SCENE_HANDLE + world.onChange so view code reads it reactively without
// reaching into the scene handle. The fetch+apply that drives rebuilds lives in
// the useCity hook; this module only holds the resulting state + the refresh
// chokepoint the hook registers into.

import { signal, effect } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { setLoadingStep } from '@/state/stores/ui';
import { LoadingStep } from '@/constants';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { isEmptyManifest } from '@/utils/manifest';

// ── Canonical manifest mirror ────────────────────────────────────────

export const MANIFEST = signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>(
  EMPTY_MANIFEST
);

let _installed = false;
function _installBridge(): void {
  if (_installed) return;
  _installed = true;
  let _worldUnsub: (() => void) | null = null;
  // effect() tracks SCENE_HANDLE (a signal); world.onChange is a custom
  // emitter, not a signal, so it stays an explicit subscription.
  effect(() => {
    const handle = SCENE_HANDLE.value;
    if (_worldUnsub) {
      _worldUnsub();
      _worldUnsub = null;
    }
    if (!handle) {
      MANIFEST.value = EMPTY_MANIFEST;
      return;
    }
    MANIFEST.value = handle.world.getManifest() ?? EMPTY_MANIFEST;
    _worldUnsub = handle.world.onChange(() => {
      MANIFEST.value = handle.world.getManifest() ?? EMPTY_MANIFEST;
    });
  });
}
_installBridge();

// ── Rebuild status ───────────────────────────────────────────────────

/**
 * State of the most recent (or current) world rebuild.
 *   'rebuilding' — applyManifest is constructing the city (streets,
 *                  buildings, gem).
 *   'decorating' — the city is already in the scene; the deferred
 *                  decoration pass (trees, etc.) is still in flight.
 */
export type RebuildStatus = 'idle' | 'rebuilding' | 'decorating' | 'error';

export const REBUILD_STATUS = signal<RebuildStatus>('idle');

/** Error message from the most recent failed rebuild; null when idle/success. */
export const LAST_REBUILD_ERROR = signal<string | null>(null);

/** Epoch millis of the most recent manifest apply (initial or via poll). */
export const LAST_UPDATED_AT = signal<number>(0);

// Bridge REBUILD_STATUS → loading overlay: when the deferred decoration pass
// starts, advance the overlay's active step so users see "Adding decorations…".
effect(() => {
  if (REBUILD_STATUS.value === 'decorating') {
    setLoadingStep(LoadingStep.Decorating);
  }
});

// Record when a (non-empty) manifest is applied — drives the footer's
// "last updated" readout. Derived from the canonical MANIFEST signal.
effect(() => {
  if (!isEmptyManifest(MANIFEST.value)) {
    LAST_UPDATED_AT.value = Date.now();
  }
});

// ── Manual refresh chokepoint ────────────────────────────────────────
// The footer's refresh button (and any future "force re-sync" UI) calls
// refreshManifest(); the useCity hook's live-poll setup registers the actual
// fetch+apply handler here. Same register/invoke shape as stores/ui's
// source-applier — the view triggers an action without importing the hook.

let _refreshHandler: (() => Promise<void>) | null = null;

/** Register the fetch+apply handler; returns an unregister fn. */
export function registerRefreshHandler(fn: () => Promise<void>): () => void {
  _refreshHandler = fn;
  return () => {
    if (_refreshHandler === fn) _refreshHandler = null;
  };
}

/** Trigger a fresh manifest fetch + apply. Resolves immediately (no-op) before
 *  the handler is registered, which only happens during boot. */
export async function refreshManifest(): Promise<void> {
  if (_refreshHandler) await _refreshHandler();
}
