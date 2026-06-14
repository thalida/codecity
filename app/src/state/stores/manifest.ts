// state/stores/manifest.ts — The current manifest: a canonical signal written
// by the fetch layer, plus the world-rebuild status that drives the
// footer + loading overlay. All session-scoped (never persisted — a rehydrated
// REBUILD_STATUS would strand the footer on "rebuilding…" after a reload).
//
// MANIFEST is the source of truth, written by the fetch layer; view code (and
// the scene render-effect) read it reactively. The fetch+apply that drives
// rebuilds lives in the useManifestSource hook; this module only holds the
// resulting state.

import { signal, effect } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';
import { setLoadingStep } from '@/state/stores/ui';
import { LoadingStep } from '@/constants/loadingSteps';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { isEmptyManifest } from '@/utils/manifest';

// ── Canonical manifest signal ────────────────────────────────────────
// Source of truth written by the fetch layer (useManifestSource). The scene
// (the City component's render effect) is a CONSUMER of this signal — it is not
// derived from world.onChange.
export const MANIFEST = signal<
  Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null
>(EMPTY_MANIFEST);

/** Set the current manifest (skeleton, final, or live-update). Single writer
 *  used by the fetch layer; views + the scene render-effect read MANIFEST. */
export function setManifest(m: Manifest | DirNode | null): void {
  MANIFEST.value = m ?? EMPTY_MANIFEST;
}

// ── Rebuild status ───────────────────────────────────────────────────

/**
 * State of the most recent (or current) world rebuild.
 *   Rebuilding — applyManifest is constructing the city (streets,
 *                buildings, gem).
 *   Decorating — the city is already in the scene; the deferred
 *                decoration pass (trees, etc.) is still in flight.
 */
export enum RebuildStatus {
  Idle = 'idle',
  Rebuilding = 'rebuilding',
  Decorating = 'decorating',
  Error = 'error',
}

export const REBUILD_STATUS = signal<RebuildStatus>(RebuildStatus.Idle);

/** Error message from the most recent failed rebuild; null when idle/success. */
export const LAST_REBUILD_ERROR = signal<string | null>(null);

/** Epoch millis of the most recent manifest apply (initial or via poll). */
export const LAST_UPDATED_AT = signal<number>(0);

// ── Status transitions (single owner of each state + its coupled writes) ──
// Every rebuild path drives REBUILD_STATUS through these so the status/error
// pair can't drift across the four call sites (City apply effect, settings
// reactions, the trees decoration pass, the fetch layer). markIdle is the
// canonical "rebuild finished" point — the trees decoration pass owns it as the
// last stage of every applyManifest (so reaching Idle also clears the error);
// markError owns the failure pair.
export function markRebuilding(): void {
  REBUILD_STATUS.value = RebuildStatus.Rebuilding;
}

export function markDecorating(): void {
  REBUILD_STATUS.value = RebuildStatus.Decorating;
}

export function markIdle(): void {
  REBUILD_STATUS.value = RebuildStatus.Idle;
  LAST_REBUILD_ERROR.value = null;
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

// Record when a (non-empty) manifest is applied — drives the footer's
// "last updated" readout. Derived from the canonical MANIFEST signal.
effect(() => {
  if (!isEmptyManifest(MANIFEST.value)) {
    LAST_UPDATED_AT.value = Date.now();
  }
});
