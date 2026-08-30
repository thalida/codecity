// features/city/state/overlay.ts — the full-screen progress the app shows over
// a load: what it says, and how far down its rows the load has got.

import { type CityStatus, CityLifecycle, CityPhase, type SourceKind } from '@codecity/city';
import { signal } from '@preact/signals';

import {
  LoadingStep,
  LOADING_STEPS,
  firstStepFor,
  countsTail,
  buildStageTail,
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

// ── The Live driver ──────────────────────────────────────────────────

/** Drive the overlay's rows off one city's status. Presentation only: which
 *  rows this app lists, and how far down them the load has got. Returns the */
export function createOverlayDriver(): (status: CityStatus, asked: LoadingSource | null) => void {
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

  return (status: CityStatus, asked: LoadingSource | null) => {
    const hide = () => {
      if (overlayUp) hideLoadingOverlay();
      overlayUp = false;
    };

    // Nothing is coming and there is nothing left to wait for. `fetching` is
    // the whole of the second half: a city can be on screen and still not be
    if (!asked && !status.fetching && status.lifecycle !== CityLifecycle.Loading) {
      hide();
      return;
    }

    if (!overlayUp && asked) {
      // The load was asked for before the city had anything to say: open on the
      // first row this source kind actually runs.
      showLoadingOverlay({ kind: asked.kind, branch: asked.branch });
      overlayUp = true;
      reached = LOADING_STEPS.indexOf(firstStepFor(LOADING_STEPS, asked.kind));
    }

    // The phase IS the row. Null with a source asked for is a load the city has
    // not reported on yet: open on the first row this kind actually runs.
    const step = status.phase ?? (asked ? firstStepFor(LOADING_STEPS, asked.kind) : null);
    if (step) advance(step);
    // The counts belong to the row that is producing them, and clear when it
    // hands over: a stale "1,204 files" beside "Building city" reads as a
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
