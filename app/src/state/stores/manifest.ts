// state/stores/manifest.ts — the current manifest and the world-rebuild status
// behind the header's freshness readout and the loading overlay. Session-scoped:
// a rehydrated REBUILD_STATUS would strand it on "rebuilding…" after a reload.

import { signal, effect } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';
import { setLoadingStep } from '@/state/stores/ui';
import { LoadingStep } from '@/constants/loadingSteps';
import { EMPTY_MANIFEST } from '@/constants/manifest';

// ── Canonical manifest signal ────────────────────────────────────────

// The union spans a final Manifest, a bare DirNode, and the loose skeleton the
// stream emits before it is fully typed.
export type ManifestValue = Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null;

export const MANIFEST = signal<ManifestValue>(EMPTY_MANIFEST);

/** Set the current manifest: skeleton, final, live-update or a rollback. The
 *  fetch layer is the single writer; everything else reads MANIFEST. */
export function setManifest(m: ManifestValue): void {
  MANIFEST.value = m ?? EMPTY_MANIFEST;
}

// ── Rebuild status ───────────────────────────────────────────────────

/** State of the most recent world rebuild. Decorating is the city already on
 *  screen with its deferred pass (trees and friends) still in flight. */
export enum RebuildStatus {
  /** Nothing has been built yet. Distinct from Idle so "a build finished" is
   *  answerable: consumers that wait for Idle used to pass at boot. */
  Pending = 'pending',
  Idle = 'idle',
  Rebuilding = 'rebuilding',
  Decorating = 'decorating',
  Error = 'error',
}

export const REBUILD_STATUS = signal<RebuildStatus>(RebuildStatus.Pending);

/** Error message from the most recent failed rebuild; null when idle/success. */
export const LAST_REBUILD_ERROR = signal<string | null>(null);

/** Epoch millis of the most recent finished apply, in whichever mode: a live
 *  scan or Timeline's history bundle both land here via markIdle. */
export const LAST_UPDATED_AT = signal<number>(0);

// ── Status transitions (single owner of each state + its coupled writes) ──

// Every rebuild path goes through these, so the status/error/timestamp set
// can't drift across the four call sites. markIdle ends every applyManifest.
export function markRebuilding(): void {
  REBUILD_STATUS.value = RebuildStatus.Rebuilding;
}

export function markDecorating(): void {
  REBUILD_STATUS.value = RebuildStatus.Decorating;
}

export function markIdle(): void {
  REBUILD_STATUS.value = RebuildStatus.Idle;
  LAST_REBUILD_ERROR.value = null;
  LAST_UPDATED_AT.value = Date.now();
}

export function markError(err: unknown): void {
  REBUILD_STATUS.value = RebuildStatus.Error;
  LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
}

// Bridge REBUILD_STATUS → loading overlay: when the deferred decoration pass
// starts, advance the overlay's active step so users see "Adding decorations…".
effect(() => {
  if (REBUILD_STATUS.value === RebuildStatus.Decorating) {
    setLoadingStep(LoadingStep.Decorating);
  }
});
