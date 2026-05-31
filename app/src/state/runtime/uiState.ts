// state/runtime/uiState.ts — Signals controlling global modal/overlay
// visibility. Components read these to show/hide themselves; callers
// write them to open/close. Replaces the imperative `picker.open()` /
// `loadingOverlay.show()` pattern from boot.ts.

import { signal } from '@preact/signals';
import type { OpenOpts } from '../../views/components/SourcePicker';
import type { LoadingOverlayShowOpts } from '../../views/components/LoadingOverlay';

// ── Source picker ────────────────────────────────────────────────────────────

export interface SourcePickerState {
  visible: boolean;
  opts: OpenOpts;
}

export const SOURCE_PICKER = signal<SourcePickerState>({
  visible: false,
  opts: {},
});

/** Open the source picker modal. */
export function openSourcePicker(opts: OpenOpts = {}): void {
  SOURCE_PICKER.value = { visible: true, opts };
}

/** Close the source picker modal. */
export function closeSourcePicker(): void {
  SOURCE_PICKER.value = { ...SOURCE_PICKER.value, visible: false };
}

// ── Loading overlay ──────────────────────────────────────────────────────────

import type { LoadingStep } from '../../views/components/LoadingOverlay';

export interface LoadingOverlayState {
  visible: boolean;
  showOpts: LoadingOverlayShowOpts | null;
  activeStep: LoadingStep | null;
  pendingLabel: string | null;
  stepTails: Partial<Record<LoadingStep, string | null>>;
}

export const LOADING_OVERLAY = signal<LoadingOverlayState>({
  visible: false,
  showOpts: null,
  activeStep: null,
  pendingLabel: null,
  stepTails: {},
});

// Setters use .peek() rather than .value to read the prior state — these
// functions are sometimes called from inside other effects (e.g. the
// REBUILD_STATUS → 'decorating' bridge), and a tracked `.value` read
// would auto-subscribe that effect to LOADING_OVERLAY, producing a cycle
// when the same effect later writes back.

export function showLoadingOverlay(opts: LoadingOverlayShowOpts): void {
  const initialStep: LoadingStep = opts.kind === 'local' ? 'scanning' : 'resolving';
  LOADING_OVERLAY.value = {
    visible: true,
    showOpts: opts,
    activeStep: initialStep,
    pendingLabel: null,
    stepTails: {},
  };
}

export function hideLoadingOverlay(): void {
  LOADING_OVERLAY.value = { ...LOADING_OVERLAY.peek(), visible: false };
}

export function setLoadingStep(step: LoadingStep): void {
  const prev = LOADING_OVERLAY.peek();
  if (prev.activeStep === step) return;
  LOADING_OVERLAY.value = { ...prev, activeStep: step };
}

export function setLoadingPendingLabel(label: string | null): void {
  LOADING_OVERLAY.value = { ...LOADING_OVERLAY.peek(), pendingLabel: label };
}

export function setLoadingStepTail(step: LoadingStep, tail: string | null): void {
  const prev = LOADING_OVERLAY.peek();
  LOADING_OVERLAY.value = {
    ...prev,
    stepTails: { ...prev.stepTails, [step]: tail },
  };
}
