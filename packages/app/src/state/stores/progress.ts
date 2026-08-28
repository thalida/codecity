// state/stores/progress.ts — how far along the thing you are waiting for is:
// what the SERVER reports, what the BUILD is doing, and what the OVERLAY shows
// on top of both. The overlay is a reduction over the other two (a running max
// over rows, the last tail each saw), which is why it needs the driver below.

import { CloneStage, ScanPhase } from '@codecity/city';
import type { Manifest, City } from '@codecity/city';
import { signal, effect } from '@preact/signals';
import { SourceKind } from '@/utils/sources';
import {
  BuildStage,
  buildStageTail,
  type BuildProgress,
  LoadingStep,
  LOADING_STEPS,
  firstStepFor,
  stepForPhase,
  transferTail,
} from '@/constants/progress';
import { MANIFEST, type ManifestValue } from './manifest';
import type { LoadingOverlayShowOpts, LoadingOverlayState } from '@/types/ui';

// ── What the server is doing ─────────────────────────────────────────

export interface ScanProgress {
  /** Kind of source being loaded (drives the overlay's initial step). */
  kind: SourceKind;
  branch?: string;
  /** Latest stream phase, or null when the load just started and no stream
   *  event has arrived yet (overlay shows the kind-based initial step). */
  phase: ScanPhase | null;
  /** Cloning percent (0-100) when phase === Cloning. */
  percent?: number;
  /** Cloning stage (e.g. Receiving, Updating) when present. */
  stage?: CloneStage;
  /** Working-tree size on disk (MB) during the silent promisor blob fetch —
   *  a clone-progress heartbeat with no stage/percent. */
  mbOnDisk?: number;
  /** Git's own counts for the clone, where its line carried them. */
  objects?: number;
  objectsTotal?: number;
  mib?: number;
  /** Files scanned so far when phase === Scanning. */
  filesScanned?: number;
}

/** Non-null while a source is actively loading; null when idle/done. */
export const SCAN_PROGRESS = signal<ScanProgress | null>(null);

// ── What the build is doing ──────────────────────────────────────────

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

/** What the city ON SCREEN is still waiting on, straight from its own
 *  build:done. A scan streams more than once: the first manifest draws real
 *  buildings while history is still coming, and history is where commits come
 *  from, so the trees land on a later build. Empty means the city you are
 *  looking at is the finished one. */
export const BUILT_PENDING = signal<Manifest['pending']>([]);

/** The manifest the FINISHED city was built from, trees included: a consumer
 *  that aims the camera at a node needs that node to exist. */
export const BUILT_MANIFEST = signal<ManifestValue>(null);

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
// stays up through the tree pass, and the trees land at the END of that stage.
export function markDecorating(): void {
  REBUILD_STATUS.value = RebuildStatus.Decorating;
  enterBuildStage(BuildStage.Decorate);
}

/** The city is on screen. Set by the composer once the meshes exist and a frame
 *  carrying them has been presented — NOT when applyStructure returns. */
export function markIdle(pending: Manifest['pending'] = []): void {
  REBUILD_STATUS.value = RebuildStatus.Idle;
  BUILT_PENDING.value = pending;
  BUILT_MANIFEST.value = MANIFEST.peek();
  LAST_REBUILD_ERROR.value = null;
  REBUILD_DETAIL.value = null;
  BUILD_PROGRESS.value = null;
  LAST_UPDATED_AT.value = Date.now();
}

export function markError(err: unknown): void {
  REBUILD_STATUS.value = RebuildStatus.Error;
  // Logged with the stack, where a developer can use it. The UI shows a generic
  // line: the message names our internals and a user cannot act on it.
  console.error('[codecity] city build failed', err);
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

// ── What the overlay shows ───────────────────────────────────────────

/** Repo name in the loading overlay's header, shown before the manifest lands.
 *  Overlay-owned: showLoadingOverlay/hideLoadingOverlay control its lifetime. */
export const PENDING_SOURCE_LABEL = signal<string | null>(null);

export const LOADING_OVERLAY = signal<LoadingOverlayState>({
  visible: false,
  showOpts: null,
  activeStep: null,
  stepTails: {},
});

// A load that can be backed out of registers its own abort; null falls back to
// the App default.
export const LOADING_CANCEL = signal<(() => void) | null>(null);

// peek, not value: these are called from inside other effects, and tracking the
// prior state would subscribe an effect to a signal it goes on to write.

// Omitting onCancel leaves any registered handler in place, so a caller can
// pre-register one before the reaction shows the overlay.
export function showLoadingOverlay(
  opts: LoadingOverlayShowOpts,
  onCancel?: (() => void) | null
): void {
  LOADING_OVERLAY.value = {
    visible: true,
    showOpts: opts,
    activeStep: firstStepFor(opts.steps ?? LOADING_STEPS, opts.kind),
    stepTails: {},
  };
  if (onCancel !== undefined) LOADING_CANCEL.value = onCancel;
}

export function setLoadingCancel(onCancel: (() => void) | null): void {
  LOADING_CANCEL.value = onCancel;
}

export function hideLoadingOverlay(): void {
  LOADING_OVERLAY.value = { ...LOADING_OVERLAY.peek(), visible: false };
  LOADING_CANCEL.value = null;
  // The header belongs to the overlay, so it clears here rather than at each
  // call site: one that forgets leaves a stale label over the next load.
  PENDING_SOURCE_LABEL.value = null;
}

export function setLoadingStep(step: LoadingStep): void {
  const prev = LOADING_OVERLAY.peek();
  if (prev.activeStep === step) return;
  LOADING_OVERLAY.value = { ...prev, activeStep: step };
}

export function setLoadingStepTail(step: LoadingStep, tail: string | null): void {
  const prev = LOADING_OVERLAY.peek();
  LOADING_OVERLAY.value = {
    ...prev,
    stepTails: { ...prev.stepTails, [step]: tail },
  };
}

// ── The Live driver ──────────────────────────────────────────────────

export function attachOverlayDriver(): () => void {
  const stops = [attachScanReaction(), attachBuildReaction()];
  return () => stops.forEach((stop) => stop());
}

// The overlay's row only: these stages pass in a few frames, and the freshness
// readout flickering through them cost more attention than they are worth.
function attachBuildReaction(): () => void {
  return effect(() => {
    setLoadingStepTail(LoadingStep.Building, buildStageTail(BUILD_PROGRESS.value));
  });
}

function attachScanReaction(): () => void {
  let overlayUp = false;
  // How far down the list this load has got. A row that lights up again after a
  // later one reads as the whole load starting over.
  let reached = -1;
  const advance = (step: LoadingStep): void => {
    if (!overlayUp) return;
    const index = LOADING_STEPS.indexOf(step);
    if (index <= reached) return;
    reached = index;
    setLoadingStep(step);
  };
  return effect(() => {
    const p = SCAN_PROGRESS.value;
    // The stream finishing is not the city appearing: Idle now means a frame of
    // it has been presented, so every earlier status keeps the overlay up.
    const status = REBUILD_STATUS.value;
    // Not "is a build running" but "is the city you would be shown the finished
    // one". A build in flight is one way to be unfinished; the other is a city
    // that IS on screen and told us more is coming.
    const unfinished =
      status === RebuildStatus.Rebuilding ||
      status === RebuildStatus.Decorating ||
      BUILT_PENDING.value.length > 0;
    const hide = () => {
      if (overlayUp) hideLoadingOverlay();
      overlayUp = false;
    };
    if (!p) {
      if (unfinished) {
        // Stream done, city still coming — keep the overlay on "Building".
        advance(LoadingStep.Building);
        return;
      }
      hide();
      return;
    }
    // A load's first event: a new list, so it starts from the top again.
    if (p.phase === null) reached = -1;
    if (!overlayUp) {
      // null→non-null: show the overlay at the kind-based initial step
      // (Resolving for git, Scanning for local).
      showLoadingOverlay({ kind: p.kind, branch: p.branch });
      overlayUp = true;
      reached = LOADING_STEPS.indexOf(firstStepFor(LOADING_STEPS, p.kind));
    }
    advance(stepForPhase(p.phase, p.kind));
    if (p.phase === ScanPhase.CloneProgress) {
      // A heartbeat during the silent promisor blob fetch has no percent at
      // all, and shows the working tree growing on disk instead.
      const tail = transferTail(p) ?? (p.mbOnDisk !== undefined ? `${p.mbOnDisk} MB` : null);
      setLoadingStepTail(LoadingStep.Cloning, tail);
    } else if (p.phase === ScanPhase.ScanProgress) {
      setLoadingStepTail(
        LoadingStep.Scanning,
        p.filesScanned !== undefined ? `${p.filesScanned.toLocaleString()} files` : null
      );
    } else if (p.phase === ScanPhase.PartialManifest || p.phase === ScanPhase.CompleteManifest) {
      // Progress tails done.
      setLoadingStepTail(LoadingStep.Cloning, null);
      setLoadingStepTail(LoadingStep.Scanning, null);
    }
    // p.phase === null: just-started; showLoadingOverlay already set the
    // kind-based initial step — nothing more to do until a real event.
  });
}

// ── Where a build's own reports come in ──────────────────────────────

/** Route one city's build events into the overlay above it. This is the app's
 *  answer to "whose build is this": only the city whose chrome this is
 *  subscribes, so the landing's wallpaper can build behind the page without
 *  moving a readout that belongs to the project you are reading.
 *
 *  Returns the unsubscribe; call it when that city goes away. */
export function attachBuildProgress(on: City['on']): () => void {
  const offs = [
    on('build:start', ({ stages }) => beginBuild(stages)),
    on('build:stage', ({ stage }) => {
      // Decoration is a stage AND a status: the city is up while it runs.
      if (stage === BuildStage.Decorate) markDecorating();
      else enterBuildStage(stage);
    }),
    on('build:progress', ({ percent }) => setBuildStagePercent(percent)),
    on('build:done', ({ pending }) => markIdle(pending)),
    on('build:error', ({ error }) => markError(error)),
  ];
  return () => {
    for (const off of offs) off();
  };
}
