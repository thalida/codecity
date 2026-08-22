// state/stores/progress.ts — how far along the thing you are waiting for is,
// for ONE city: what the server reports, what the build is doing, and what the
// overlay shows over both. The overlay is a reduction over the other two,
// which is why it needs the driver at the bottom.

import { signal, computed, effect } from '@preact/signals';
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

/** How far along the thing you are waiting for is, for ONE city. It IS that
 *  city's BuildReporter: the scene writes its status straight in here. */
export class ProgressStore implements BuildReporter {
  /** Non-null while this city is actively loading; null when idle/done. */
  readonly scan = signal<ScanProgress | null>(null);
  readonly rebuildStatus = signal<RebuildStatus>(RebuildStatus.Pending);
  /** The manifest the FINISHED city was built from, trees included: a consumer
   *  that aims the camera at a node needs that node to exist. */
  readonly builtManifest = signal<ManifestValue>(null);
  /** Whether a finished city is on screen RIGHT NOW: set when one is presented,
   *  cleared when the canvas goes away. Not "has anything ever been built". */
  readonly cityOnScreen = computed<boolean>(() => this.builtManifest.value !== null);
  /** Error message from the most recent failed rebuild; null when idle. */
  readonly lastError = signal<string | null>(null);
  /** Progress beside "rebuilding…", for the one build nothing else reports:
   *  Timeline's no-overlay refetch. Every transition clears it. */
  readonly detail = signal<string | null>(null);
  /** Epoch millis of the most recent finished apply, in whichever mode. */
  readonly lastUpdatedAt = signal<number>(0);
  /** Which stage the running build is on, null between builds. */
  readonly buildProgress = signal<BuildProgress | null>(null);

  /** The overlay over this city, and the repo name in its header. */
  readonly overlay = signal<LoadingOverlayState>({
    visible: false,
    showOpts: null,
    activeStep: null,
    stepTails: {},
  });
  readonly pendingLabel = signal<string | null>(null);
  /** A load that can be backed out of registers its own abort here. */
  readonly cancel = signal<(() => void) | null>(null);

  constructor(
    private readonly manifest: ManifestStore,
    private readonly source: SourceStore
  ) {}

  // ── Status transitions ───────────────────────────────────────────
  // Every rebuild path goes through these, so the set cannot drift.

  markRebuilding = (): void => {
    this.rebuildStatus.value = RebuildStatus.Rebuilding;
    this.detail.value = null;
    this.buildProgress.value = null;
  };

  /** Decoration is the build's last stage, not the end of it: the overlay stays
   *  up through the tree pass, and the trees land at the END of that stage. */
  markDecorating = (): void => {
    this.rebuildStatus.value = RebuildStatus.Decorating;
    this.enterBuildStage(BuildStage.Decorate);
  };

  /** The city is on screen. Set by the composer once the meshes exist and a
   *  frame carrying them has been presented — NOT when applyStructure returns. */
  markIdle = (): void => {
    this.rebuildStatus.value = RebuildStatus.Idle;
    this.builtManifest.value = this.manifest.current.peek();
    this.lastError.value = null;
    this.detail.value = null;
    this.buildProgress.value = null;
    this.lastUpdatedAt.value = Date.now();
  };

  /** The canvas went away (leaving `/city` unmounts it), so nothing is on
   *  screen: the remount's rebuild is a load with a world to wait for. */
  markGone = (): void => {
    this.rebuildStatus.value = RebuildStatus.Pending;
    this.builtManifest.value = null;
    this.detail.value = null;
    this.buildProgress.value = null;
  };

  markError = (err: unknown): void => {
    this.rebuildStatus.value = RebuildStatus.Error;
    // Logged with the stack, where a developer can use it. The UI shows a
    // generic line: the message names our internals, and a user cannot act on it.
    console.error('[codecity] city build failed', err);
    this.lastError.value = err instanceof Error ? err.message : String(err);
    this.detail.value = null;
    this.buildProgress.value = null;
  };

  status = (): RebuildStatus => this.rebuildStatus.peek();

  /** How far along the rebuild already announced by markRebuilding is. */
  setDetail = (detail: string | null): void => {
    this.detail.value = detail;
  };

  // ── Build stages ─────────────────────────────────────────────────
  // The plan is per build: only what runs is an honest denominator.

  beginBuild = (stages: readonly BuildStage[]): void => {
    this.buildProgress.value = { stages, index: 0, percent: null };
  };

  /** Advance to a stage of the declared plan. A stage the plan didn't list is
   *  ignored rather than appended: the denominator was already shown. */
  enterBuildStage = (stage: BuildStage): void => {
    const prev = this.buildProgress.peek();
    if (!prev) return;
    const index = prev.stages.indexOf(stage);
    if (index < 0 || index === prev.index) return;
    this.buildProgress.value = { ...prev, index, percent: null };
  };

  setBuildStagePercent = (percent: number): void => {
    const prev = this.buildProgress.peek();
    if (!prev || prev.percent === percent) return;
    this.buildProgress.value = { ...prev, percent };
  };

  // ── The overlay ──────────────────────────────────────────────────
  // peek, not value: called from effects that go on to write what they read.

  /** Omitting onCancel leaves any registered handler in place, so a caller can
   *  pre-register one before the reaction shows the overlay. */
  showOverlay = (opts: LoadingOverlayShowOpts, onCancel?: (() => void) | null): void => {
    this.overlay.value = {
      visible: true,
      showOpts: opts,
      activeStep: firstStepFor(opts.steps ?? LOADING_STEPS, opts.kind),
      stepTails: {},
    };
    if (onCancel !== undefined) this.cancel.value = onCancel;
  };

  hideOverlay = (): void => {
    this.overlay.value = { ...this.overlay.peek(), visible: false };
    this.cancel.value = null;
    // The header belongs to the overlay, so it clears here rather than at each
    // call site: one that forgets leaves a stale label over the next load.
    this.pendingLabel.value = null;
  };

  setStep = (step: LoadingStep): void => {
    const prev = this.overlay.peek();
    if (prev.activeStep === step) return;
    this.overlay.value = { ...prev, activeStep: step };
  };

  setStepTail = (step: LoadingStep, tail: string | null): void => {
    const prev = this.overlay.peek();
    this.overlay.value = { ...prev, stepTails: { ...prev.stepTails, [step]: tail } };
  };

  setCancel = (onCancel: (() => void) | null): void => {
    this.cancel.value = onCancel;
  };

  /** Drive the overlay off this city's scan + build. Returns a dispose. */
  attachOverlayDriver = (): (() => void) => {
    const stops = [this.attachLoadReaction(), this.attachBuildReaction()];
    return () => stops.forEach((stop) => stop());
  };

  /** The overlay's row only: these stages pass in a few frames, and the
   *  freshness readout flickering through them cost more than they are worth. */
  private attachBuildReaction(): () => void {
    return effect(() => {
      this.setStepTail(LoadingStep.Building, buildStageTail(this.buildProgress.value));
    });
  }

  /** The overlay's whole lifetime: up while a world is coming, down once that
   *  world is ON SCREEN. The stream ending is only the middle of that wait. */
  private attachLoadReaction(): () => void {
    let overlayUp = false;
    // How far down the list this load has got. A row that lights up again after
    // a later one reads as the whole load starting over.
    let reached = -1;
    const advance = (step: LoadingStep): void => {
      if (!overlayUp) return;
      const index = LOADING_STEPS.indexOf(step);
      if (index <= reached) return;
      reached = index;
      this.setStep(step);
    };
    // Nothing was fetched, so the build row is the only honest one. An overlay
    // already up belongs to whoever raised it (Timeline brings its own list).
    const showForBuild = (): void => {
      if (this.overlay.peek().visible) return;
      this.pendingLabel.value = this.source.info.peek().label || null;
      this.showOverlay({ kind: null, steps: BUILD_ONLY_STEPS });
      overlayUp = true;
      reached = -1;
    };
    return effect(() => {
      const p = this.scan.value;
      // The stream finishing is not the city appearing: Idle means a frame of
      // it has been presented, so every earlier status keeps the overlay up.
      const status = this.rebuildStatus.value;
      const building = status === RebuildStatus.Rebuilding || status === RebuildStatus.Decorating;
      const onScreen = this.cityOnScreen.value;
      const hide = () => {
        if (overlayUp) this.hideOverlay();
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
        // null→non-null: show at the kind-based initial step.
        this.showOverlay({ kind: p.kind, branch: p.branch });
        overlayUp = true;
        reached = LOADING_STEPS.indexOf(firstStepFor(LOADING_STEPS, p.kind));
      }
      advance(stepForPhase(p.phase, p.kind, p.appliedPending));
      if (p.phase === ScanPhase.CloneProgress) {
        // A heartbeat during the silent promisor blob fetch has no percent at
        // all, and shows the working tree growing on disk instead.
        const tail = transferTail(p) ?? (p.mbOnDisk !== undefined ? `${p.mbOnDisk} MB` : null);
        this.setStepTail(LoadingStep.Cloning, tail);
      } else if (p.phase === ScanPhase.ScanProgress) {
        this.setStepTail(
          LoadingStep.Scanning,
          p.filesScanned !== undefined ? `${p.filesScanned.toLocaleString()} files` : null
        );
      } else if (p.phase === ScanPhase.PartialManifest || p.phase === ScanPhase.CompleteManifest) {
        this.setStepTail(LoadingStep.Cloning, null);
        this.setStepTail(LoadingStep.Scanning, null);
      }
    });
  }
}
