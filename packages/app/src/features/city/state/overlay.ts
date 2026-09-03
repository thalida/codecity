// features/city/state/overlay.ts — the full-screen progress the app shows over
// a load: what it says, and how far down its rows the load has got.

import { type CityStatus, CityLifecycle, CityPhase, type SourceKind } from '@codecity/city';
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

/** What this app knows before the city speaks: which kind of source, its
 *  branch, and what to call it. */
export interface LoadingAbout extends LoadingSource {
  label?: string | null;
}

/** Drive the overlay. Presentation only: which rows this app lists, and how far
 *  down them the load has got. What is HAPPENING is the city's to say. */
export function createOverlayDriver(
  cancels: OverlayCancels = {}
): (status: CityStatus, asked: LoadingAbout | null) => void {
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

  return (status, asked) => {
    // The CITY says which of the two it is doing: a history read is not a scan,
    // and this asks rather than inferring it from what events are arriving.
    const reading = status.phase === CityPhase.Reading;

    // Nothing coming, nothing left to wait for. `fetching` is the second
    // half: a city can be on screen and still not be the finished one.
    if (!asked && !status.fetching && status.lifecycle !== CityLifecycle.Loading) {
      close();
      return;
    }

    // The rows the load in flight runs, re-opened if it turns out to be the
    // other kind: entering Timeline becomes a read on the city's first report.
    // A read that has reached its pack reports Building like any other, so the
    // rows stay the read's until the load ENDS: the pack is part of it.
    const want = reading || showing === Showing.Timeline ? Showing.Timeline : Showing.Live;
    if (asked && showing !== want) {
      open(want, asked, reading ? TIMELINE_LOADING_STEPS : undefined);
    }
    // The overlay owns what it displays: one writer, so a label from the load
    // before this one cannot be left standing over it.
    if (showing !== Showing.Nothing && asked?.label) PENDING_SOURCE_LABEL.value = asked.label;

    // The phase IS the row. Inside a read the timeline stage is the finer one,
    // the way BuildStage is inside Building.
    const step = reading
      ? status.timelineStage
        ? stepForTimelineStage(status.timelineStage)
        : null
      : (status.phase ?? (asked ? firstStepFor(LOADING_STEPS, asked.kind) : null));
    if (step) advance(step);

    // The counts belong to the row producing them, and clear when it hands
    // over: a stale "1,204 files" beside "Building city" reads as still running.
    const readTail = reading ? timelineStageTail(status) : null;
    setLoadingStepTail(
      LoadingStep.TimelineFetch,
      step === LoadingStep.TimelineFetch ? readTail : null
    );
    setLoadingStepTail(
      LoadingStep.TimelineHistory,
      step === LoadingStep.TimelineHistory ? readTail : null
    );
    setLoadingStepTail(
      LoadingStep.TimelineBlobs,
      step === LoadingStep.TimelineBlobs ? readTail : null
    );
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
  };
}
