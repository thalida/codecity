// state/runtime/uiState.ts — Signals controlling global modal/overlay
// visibility. Components read these to show/hide themselves; callers
// write them to open/close. Replaces the imperative `picker.open()` /
// `loadingOverlay.show()` pattern from boot.ts.

import { signal } from '@preact/signals';
import type { OpenOpts, SourcePayload } from '../../views/components/SourcePicker';
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

/** Open the picker pre-filled with the current `?src`/`?branch` — the
 *  header's "switch source" affordance. Always dismissible. */
export function openSourcePickerForCurrentSource(): void {
  const cur = new URLSearchParams(window.location.search);
  openSourcePicker({
    dismissible: true,
    prefill: cur.has('src')
      ? { src: cur.get('src')!, branch: cur.get('branch') ?? undefined }
      : undefined,
  });
}

// Apply-new-source handler. The boot wiring (sourcePickerBridge) registers the
// function that actually fetches + applies a source — it needs the live scene
// and live-update handles. The picker UI calls submitNewSource(); no window
// globals. Same register/invoke shape as manifestPoll's refreshManifest.
let _sourceApplier: ((payload: SourcePayload) => void) | null = null;

/** Register the apply-new-source handler; returns an unregister fn. */
export function registerSourceApplier(fn: (payload: SourcePayload) => void): () => void {
  _sourceApplier = fn;
  return () => {
    if (_sourceApplier === fn) _sourceApplier = null;
  };
}

/** Submit a new source from the picker. No-op before boot registers the
 *  applier (which only happens once, during initial load). */
export function submitNewSource(payload: SourcePayload): void {
  _sourceApplier?.(payload);
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
