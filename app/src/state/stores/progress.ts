// state/stores/progress.ts — how far along the thing you are waiting for is,
// for ONE project: what the server reports, what the build is doing, and what
// the overlay shows over both. The overlay is a reduction over the other two,
// which is why it needs the driver at the bottom.

import { signal, computed, effect, type ReadonlySignal, type Signal } from '@preact/signals';
import { SourceKind } from '@/utils/sources';
import { ScanPhase, CloneStage } from '@/api/manifest';
import type { Manifest } from '@/types';
import {
  BuildStage,
  buildStageTail,
  type BuildProgress,
  LoadingStep,
  LOADING_STEPS,
  BUILD_ONLY_STEPS,
  firstStepFor,
  stepForPhase,
  transferTail,
} from '@/constants/progress';
import type { ManifestStore, ManifestValue } from './manifest';
import type { SourceStore } from './source';
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
  /** `pending` of the manifest most recently APPLIED this load. Absent until
   *  its first manifest event, so a previous repo's can't leak in. */
  appliedPending?: Manifest['pending'];
}

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

/** The status writes a city makes as it assembles: how its build reaches the
 *  readouts describing it, or does not, when nobody is waiting for that one. */
export interface BuildReporter {
  beginBuild(stages: readonly BuildStage[]): void;
  enterBuildStage(stage: BuildStage): void;
  setBuildStagePercent(percent: number): void;
  markRebuilding(): void;
  markDecorating(): void;
  markIdle(): void;
  markError(err: unknown): void;
  /** The canvas went away, so whatever it had on it is not on screen. */
  markGone(): void;
  /** Read back, for a caller checking whether its own flash still stands. */
  status(): RebuildStatus;
}

/** Scenery: nobody is waiting for it, and a finished wallpaper claiming a city
 *  is on screen outlives the canvas it was drawn on. */
export const SILENT_BUILD_REPORTER: BuildReporter = {
  beginBuild: () => {},
  enterBuildStage: () => {},
  setBuildStagePercent: () => {},
  markRebuilding: () => {},
  markDecorating: () => {},
  markIdle: () => {},
  markGone: () => {},
  // Logged, never surfaced: a city nobody is waiting for has no readout to fail
  // in, and a silent throw is how a broken wallpaper goes unnoticed.
  markError: (err) => console.error('[codecity] scenery build failed', err),
  status: () => RebuildStatus.Pending,
};

export interface ProgressStore {
  /** Non-null while this project is actively loading; null when idle/done. */
  readonly scan: Signal<ScanProgress | null>;
  readonly rebuildStatus: Signal<RebuildStatus>;
  /** The manifest the FINISHED city was built from, trees included: a consumer
   *  that aims the camera at a node needs that node to exist. */
  readonly builtManifest: Signal<ManifestValue>;
  /** Whether a finished city is on screen RIGHT NOW: set when one is presented,
   *  cleared when the canvas goes away. Not "has anything ever been built". */
  readonly cityOnScreen: ReadonlySignal<boolean>;
  /** Error message from the most recent failed rebuild; null when idle/success. */
  readonly lastError: Signal<string | null>;
  /** Progress beside "rebuilding…", for the one build nothing else reports:
   *  Timeline's no-overlay refetch. Every transition clears it. */
  readonly detail: Signal<string | null>;
  /** Epoch millis of the most recent finished apply, in whichever mode. */
  readonly lastUpdatedAt: Signal<number>;
  /** Which stage the running build is on, null between builds. */
  readonly buildProgress: Signal<BuildProgress | null>;
  /** This project's city writes its status here. */
  readonly reporter: BuildReporter;
  /** How far along the rebuild already announced by markRebuilding is. */
  setDetail(detail: string | null): void;

  // ── The overlay over this project ──
  readonly overlay: Signal<LoadingOverlayState>;
  /** Repo name in the overlay's header, shown before the manifest lands. */
  readonly pendingLabel: Signal<string | null>;
  /** A load that can be backed out of registers its own abort; null falls back
   *  to the view's default. */
  readonly cancel: Signal<(() => void) | null>;
  showOverlay(opts: LoadingOverlayShowOpts, onCancel?: (() => void) | null): void;
  hideOverlay(): void;
  setStep(step: LoadingStep): void;
  setStepTail(step: LoadingStep, tail: string | null): void;
  setCancel(onCancel: (() => void) | null): void;
  /** Drive the overlay off this project's scan + build. Returns a dispose. */
  attachOverlayDriver(): () => void;
}

export function createProgressStore({
  manifest,
  source,
}: {
  manifest: ManifestStore;
  source: SourceStore;
}): ProgressStore {
  const scan = signal<ScanProgress | null>(null);
  const rebuildStatus = signal<RebuildStatus>(RebuildStatus.Pending);
  const builtManifest = signal<ManifestValue>(null);
  const cityOnScreen = computed<boolean>(() => builtManifest.value !== null);
  const lastError = signal<string | null>(null);
  const detail = signal<string | null>(null);
  const lastUpdatedAt = signal<number>(0);
  const buildProgress = signal<BuildProgress | null>(null);

  const overlay = signal<LoadingOverlayState>({
    visible: false,
    showOpts: null,
    activeStep: null,
    stepTails: {},
  });
  const pendingLabel = signal<string | null>(null);
  const cancel = signal<(() => void) | null>(null);

  // ── Status transitions (single owner of each state + its coupled writes) ──

  // Every rebuild path goes through these, so the status/error/timestamp set
  // can't drift across call sites. markIdle ends every applyManifest.
  function markRebuilding(): void {
    rebuildStatus.value = RebuildStatus.Rebuilding;
    detail.value = null;
    buildProgress.value = null;
  }

  // Decoration is the build's last stage, not the end of it: the overlay stays
  // up through the tree pass, and the trees land at the END of that stage.
  function markDecorating(): void {
    rebuildStatus.value = RebuildStatus.Decorating;
    enterBuildStage(BuildStage.Decorate);
  }

  /** The city is on screen. Set by the composer once the meshes exist and a
   *  frame carrying them has been presented — NOT when applyStructure returns. */
  function markIdle(): void {
    rebuildStatus.value = RebuildStatus.Idle;
    builtManifest.value = manifest.current.peek();
    lastError.value = null;
    detail.value = null;
    buildProgress.value = null;
    lastUpdatedAt.value = Date.now();
  }

  /** The canvas went away (leaving `/city` unmounts it), so nothing is on
   *  screen: the remount's rebuild is a load with a world to wait for. */
  function markGone(): void {
    rebuildStatus.value = RebuildStatus.Pending;
    builtManifest.value = null;
    detail.value = null;
    buildProgress.value = null;
  }

  function markError(err: unknown): void {
    rebuildStatus.value = RebuildStatus.Error;
    // Logged with the stack, where a developer can use it. The UI shows a
    // generic line: the message names our internals and a user cannot act on it.
    console.error('[codecity] city build failed', err);
    lastError.value = err instanceof Error ? err.message : String(err);
    detail.value = null;
    buildProgress.value = null;
  }

  // ── Build stages ───────────────────────────────────────────────────

  // The plan is per build: only what runs is an honest denominator.
  function beginBuild(stages: readonly BuildStage[]): void {
    buildProgress.value = { stages, index: 0, percent: null };
  }

  /** Advance to a stage of the declared plan. A stage the plan didn't list is
   *  ignored rather than appended: the denominator was already shown. */
  function enterBuildStage(stage: BuildStage): void {
    const prev = buildProgress.peek();
    if (!prev) return;
    const index = prev.stages.indexOf(stage);
    if (index < 0 || index === prev.index) return;
    buildProgress.value = { ...prev, index, percent: null };
  }

  function setBuildStagePercent(percent: number): void {
    const prev = buildProgress.peek();
    if (!prev || prev.percent === percent) return;
    buildProgress.value = { ...prev, percent };
  }

  const reporter: BuildReporter = {
    beginBuild,
    enterBuildStage,
    setBuildStagePercent,
    markRebuilding,
    markDecorating,
    markIdle,
    markError,
    markGone,
    status: () => rebuildStatus.peek(),
  };

  // ── What the overlay shows ─────────────────────────────────────────

  // peek, not value: these are called from inside effects, and tracking the
  // prior state would subscribe an effect to a signal it goes on to write.

  // Omitting onCancel leaves any registered handler in place, so a caller can
  // pre-register one before the reaction shows the overlay.
  function showOverlay(opts: LoadingOverlayShowOpts, onCancel?: (() => void) | null): void {
    overlay.value = {
      visible: true,
      showOpts: opts,
      activeStep: firstStepFor(opts.steps ?? LOADING_STEPS, opts.kind),
      stepTails: {},
    };
    if (onCancel !== undefined) cancel.value = onCancel;
  }

  function hideOverlay(): void {
    overlay.value = { ...overlay.peek(), visible: false };
    cancel.value = null;
    // The header belongs to the overlay, so it clears here rather than at each
    // call site: one that forgets leaves a stale label over the next load.
    pendingLabel.value = null;
  }

  function setStep(step: LoadingStep): void {
    const prev = overlay.peek();
    if (prev.activeStep === step) return;
    overlay.value = { ...prev, activeStep: step };
  }

  function setStepTail(step: LoadingStep, tail: string | null): void {
    const prev = overlay.peek();
    overlay.value = { ...prev, stepTails: { ...prev.stepTails, [step]: tail } };
  }

  // ── The driver ─────────────────────────────────────────────────────

  // The overlay's row only: these stages pass in a few frames, and the
  // freshness readout flickering through them cost more than they are worth.
  function attachBuildReaction(): () => void {
    return effect(() => {
      setStepTail(LoadingStep.Building, buildStageTail(buildProgress.value));
    });
  }

  // The overlay's whole lifetime: up while a world is coming, down once that
  // world is ON SCREEN. The stream ending is only the middle of that wait.
  function attachLoadReaction(): () => void {
    let overlayUp = false;
    // How far down the list this load has got. A row that lights up again after
    // a later one reads as the whole load starting over.
    let reached = -1;
    const advance = (step: LoadingStep): void => {
      if (!overlayUp) return;
      const index = LOADING_STEPS.indexOf(step);
      if (index <= reached) return;
      reached = index;
      setStep(step);
    };
    // Nothing was fetched, so the build row is the only honest one. An overlay
    // already up belongs to whoever raised it (Timeline brings its own list).
    const showForBuild = (): void => {
      if (overlay.peek().visible) return;
      pendingLabel.value = source.info.peek().label || null;
      showOverlay({ kind: null, steps: BUILD_ONLY_STEPS });
      overlayUp = true;
      reached = -1;
    };
    return effect(() => {
      const p = scan.value;
      // The stream finishing is not the city appearing: Idle means a frame of
      // it has been presented, so every earlier status keeps the overlay up.
      const status = rebuildStatus.value;
      const building = status === RebuildStatus.Rebuilding || status === RebuildStatus.Decorating;
      const onScreen = cityOnScreen.value;
      const hide = () => {
        if (overlayUp) hideOverlay();
        overlayUp = false;
      };
      if (!p) {
        // A build is all that's left to wait for: this overlay's own, or one for
        // a city not up yet. A rebuild UNDER one is the footer's to report.
        if (building && (overlayUp || !onScreen)) {
          if (!overlayUp) showForBuild();
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
        showOverlay({ kind: p.kind, branch: p.branch });
        overlayUp = true;
        reached = LOADING_STEPS.indexOf(firstStepFor(LOADING_STEPS, p.kind));
      }
      advance(stepForPhase(p.phase, p.kind, p.appliedPending));
      if (p.phase === ScanPhase.CloneProgress) {
        // A heartbeat during the silent promisor blob fetch has no percent at
        // all, and shows the working tree growing on disk instead.
        const tail = transferTail(p) ?? (p.mbOnDisk !== undefined ? `${p.mbOnDisk} MB` : null);
        setStepTail(LoadingStep.Cloning, tail);
      } else if (p.phase === ScanPhase.ScanProgress) {
        setStepTail(
          LoadingStep.Scanning,
          p.filesScanned !== undefined ? `${p.filesScanned.toLocaleString()} files` : null
        );
      } else if (p.phase === ScanPhase.PartialManifest || p.phase === ScanPhase.CompleteManifest) {
        // Progress tails done.
        setStepTail(LoadingStep.Cloning, null);
        setStepTail(LoadingStep.Scanning, null);
      }
      // p.phase === null: just-started; showOverlay already set the kind-based
      // initial step — nothing more to do until a real event.
    });
  }

  return {
    scan,
    rebuildStatus,
    builtManifest,
    cityOnScreen,
    lastError,
    detail,
    lastUpdatedAt,
    buildProgress,
    reporter,
    setDetail: (next) => {
      detail.value = next;
    },
    overlay,
    pendingLabel,
    cancel,
    showOverlay,
    hideOverlay,
    setStep,
    setStepTail,
    setCancel: (onCancel) => {
      cancel.value = onCancel;
    },
    attachOverlayDriver() {
      const stops = [attachLoadReaction(), attachBuildReaction()];
      return () => stops.forEach((stop) => stop());
    },
  };
}
