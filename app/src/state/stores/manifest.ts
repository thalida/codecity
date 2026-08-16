// One of four answers to "which tree does this surface show":
//   manifest         HEAD, the project you opened            (fetched)
//   scrubbedManifest a real scan AT the scrubbed commit      (fetched)
//   presentPaths     the paths alive at that commit          (derived)
//   paneManifest     what the tree and search show           (derived)
//
// state/stores/manifest.ts — the current manifest and the world-rebuild status
// behind the header's freshness readout and the loading overlay. Session-scoped:
// a rehydrated REBUILD_STATUS would strand it on "rebuilding…" after a reload.

import { signal } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';
import { BuildStage, type BuildProgress } from '@/constants/buildStages';
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

/** The manifest the city on screen was built from. Idle doesn't say WHOSE city
 *  landed (the empty boot city settles into it too), so read this instead. */
export const BUILT_MANIFEST = signal<ManifestValue>(EMPTY_MANIFEST);

/** Error message from the most recent failed rebuild; null when idle/success. */
export const LAST_REBUILD_ERROR = signal<string | null>(null);

/** Progress beside "rebuilding…", for the one build nothing else reports:
 *  Timeline's no-overlay refetch. Every transition clears it. */
export const REBUILD_DETAIL = signal<string | null>(null);

/** Epoch millis of the most recent finished apply, in whichever mode: a live
 *  scan or Timeline's history bundle both land here via markIdle. */
export const LAST_UPDATED_AT = signal<number>(0);

/** Which stage the running build is on, null between builds. The one source
 *  behind both of its readouts (see state/loadingReactions.ts). */
export const BUILD_PROGRESS = signal<BuildProgress | null>(null);

// ── Status transitions (single owner of each state + its coupled writes) ──

// Every rebuild path goes through these, so the status/error/timestamp set
// can't drift across the four call sites. markIdle ends every applyManifest.
export function markRebuilding(): void {
  REBUILD_STATUS.value = RebuildStatus.Rebuilding;
  REBUILD_DETAIL.value = null;
  BUILD_PROGRESS.value = null;
}

// Decoration is the build's last stage, not the end of it: Timeline's overlay
// stays up through the tree pass, so the readout has to carry on into it.
export function markDecorating(): void {
  REBUILD_STATUS.value = RebuildStatus.Decorating;
  enterBuildStage(BuildStage.Decorate);
  BUILT_MANIFEST.value = MANIFEST.peek();
}

export function markIdle(): void {
  REBUILD_STATUS.value = RebuildStatus.Idle;
  BUILT_MANIFEST.value = MANIFEST.peek();
  LAST_REBUILD_ERROR.value = null;
  REBUILD_DETAIL.value = null;
  BUILD_PROGRESS.value = null;
  LAST_UPDATED_AT.value = Date.now();
}

export function markError(err: unknown): void {
  REBUILD_STATUS.value = RebuildStatus.Error;
  LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
  REBUILD_DETAIL.value = null;
  BUILD_PROGRESS.value = null;
}

/** How far along the rebuild already announced by markRebuilding is. */
export function setRebuildDetail(detail: string | null): void {
  REBUILD_DETAIL.value = detail;
}

// ── Build stages ─────────────────────────────────────────────────────

// The build's own transitions, owned here for the same reason as the status
// ones above. The plan is per build: only what runs is an honest denominator.

/** Open a build on the first of the stages it is going to run. */
export function beginBuild(stages: readonly BuildStage[]): void {
  BUILD_PROGRESS.value = { stages, index: 0, percent: null };
}

/** Advance to a stage of the declared plan. A stage the plan didn't list is
 *  ignored rather than appended: the denominator was already shown. */
export function enterBuildStage(stage: BuildStage): void {
  const prev = BUILD_PROGRESS.peek();
  if (!prev) return;
  const index = prev.stages.indexOf(stage);
  if (index < 0 || index === prev.index) return;
  BUILD_PROGRESS.value = { ...prev, index, percent: null };
}

/** Report progress within the current stage, for one that can measure itself. */
export function setBuildStagePercent(percent: number): void {
  const prev = BUILD_PROGRESS.peek();
  if (!prev || prev.percent === percent) return;
  BUILD_PROGRESS.value = { ...prev, percent };
}
