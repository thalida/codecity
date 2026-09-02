// features/city/state/overlay.ts — the full-screen progress the app shows over
// a load: what it says, and how far down its rows the load has got.

import {
  type CityStatus,
  type TimelineProgress,
  CityLifecycle,
  CityPhase,
  TimelineStage,
  type SourceKind,
} from '@codecity/city';
import { signal } from '@preact/signals';

import {
  LoadingStep,
  LOADING_STEPS,
  TIMELINE_LOADING_STEPS,
  firstStepFor,
  countsTail,
  buildStageTail,
  stepForTimelineStage,
  timelineStageTail,
} from '@/features/city/state/loading';

/** What THIS app asked for, which it knows before the city reports anything:
 *  a local path skips the rows a remote source runs, and the branch is in the */
export interface LoadingSource {
  kind: SourceKind;
  branch?: string;
}

/** Options for showing the loading overlay. */
export interface LoadingOverlayShowOpts {
  kind: SourceKind;
  branch?: string;
  /** Custom step list (e.g. Timeline-mode entry). Defaults to LOADING_STEPS. */
  steps?: readonly LoadingStep[];
}

export interface LoadingOverlayState {
  visible: boolean;
  showOpts: LoadingOverlayShowOpts | null;
  activeStep: LoadingStep | null;
  stepTails: Partial<Record<LoadingStep, string | null>>;
}

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

// ── The one driver ───────────────────────────────────────────────────

/** Which load the overlay is describing: one overlay, two vocabularies. A live
 *  scan clones and walks; a timeline read fetches history and replays blobs. */
enum Showing {
  Nothing,
  Live,
  Timeline,
}

export interface OverlayCancels {
  /** Backing out of a live load: there is no city to fall back to, so the URL
   *  describing it goes with it. */
  live?(): void;
  /** Backing out of a timeline read: the city on screen stays, in Live. */
  timeline?(): void;
}

export interface OverlayDriver {
  /** What the city says it is doing, plus what this app asked for. */
  status(status: CityStatus, asked: LoadingSource | null): void;
  /** A timeline read's own stages, and the repo it is reading. */
  timeline(event: TimelineProgress, about: LoadingSource & { label?: string | null }): void;
}

/** Drive the overlay. Presentation only: which rows this app lists, and how far
 *  down them the load has got. What is HAPPENING is the city's to say. */
export function createOverlayDriver(cancels: OverlayCancels = {}): OverlayDriver {
  let showing = Showing.Nothing;
  // How far down the list this load has got. A row that lights up again after a
  // later one reads as the whole load starting over.
  let reached = -1;
  let rows: readonly LoadingStep[] = LOADING_STEPS;

  const advance = (step: LoadingStep): void => {
    const index = rows.indexOf(step);
    if (index <= reached) return;
    reached = index;
    setLoadingStep(step);
  };

  const open = (next: Showing, about: LoadingSource, steps?: readonly LoadingStep[]): void => {
    showing = next;
    rows = steps ?? LOADING_STEPS;
    reached = rows.indexOf(firstStepFor(rows, about.kind));
    showLoadingOverlay(
      { kind: about.kind, branch: about.branch, steps },
      next === Showing.Timeline ? (cancels.timeline ?? null) : (cancels.live ?? null)
    );
  };

  const close = (): void => {
    if (showing !== Showing.Nothing) hideLoadingOverlay();
    showing = Showing.Nothing;
    reached = -1;
  };

  return {
    status(status, asked) {
      // Nothing coming, nothing left to wait for. `fetching` is the second
      // half: a city can be on screen and still not be the finished one.
      if (!asked && !status.fetching && status.lifecycle !== CityLifecycle.Loading) {
        close();
        return;
      }

      // Only from nothing: a timeline read already showing is the SAME load,
      // and a city reports `fetching` through one exactly as through a scan.
      if (showing === Showing.Nothing && asked) open(Showing.Live, asked);

      // The phase IS the row, measured against the rows this load runs:
      // Building is the one both share, the pack at the end of either.
      const step = status.phase ?? (asked ? firstStepFor(LOADING_STEPS, asked.kind) : null);
      if (step) advance(step);
      // The counts belong to the row producing them, and clear when it hands
      // over: a stale "1,204 files" beside "Building city" reads as still running.
      setLoadingStepTail(
        LoadingStep.Cloning,
        step === LoadingStep.Cloning ? countsTail(status) : null
      );
      setLoadingStepTail(
        LoadingStep.Scanning,
        step === LoadingStep.Scanning ? countsTail(status) : null
      );
      setLoadingStepTail(
        LoadingStep.Building,
        step === CityPhase.Building ? buildStageTail(status) : null
      );
    },

    timeline(event, about) {
      if (showing !== Showing.Timeline) {
        PENDING_SOURCE_LABEL.value = about.label ?? null;
        open(Showing.Timeline, about, TIMELINE_LOADING_STEPS);
      }
      // The server's assembly and the pack after it are the same wait: one row
      // from here to the painted city.
      if (event.stage === TimelineStage.Assemble) {
        advance(LoadingStep.Building);
        return;
      }
      const step = stepForTimelineStage(event.stage);
      advance(step);
      setLoadingStepTail(step, timelineStageTail(event));
    },
  };
}
