// state/stores/ui.ts — Signals controlling global modal/overlay
// visibility. Components read these to show/hide themselves; callers
// write them to open/close. Replaces the imperative `picker.open()` /
// `loadingOverlay.show()` boot-time pattern.

import { signal } from '@preact/signals';
import { SourceKind } from '@/utils/sources';
import { URL_PARAMS } from '@/constants/urlParams';

// These are the UI-state CONTRACTS the views render against. They live here (in
// state) so state/ stays view-independent — the SourcePicker / LoadingOverlay
// components import them from here, not the other way around.

/** What the source picker submits when the user opens a project. */
export interface SourcePayload {
  src: string;
  branch?: string;
  /** When true, this open forces a fresh scan (server-side ?no_cache=1).
   *  Not persisted — re-opening from a recent uses cached scan by default. */
  skipCache?: boolean;
}

/** Options for opening the source picker. */
export interface OpenOpts {
  prefill?: SourcePayload;
  dismissible?: boolean; // default: false
  error?: string;
}

/** Options for showing the loading overlay. */
export interface LoadingOverlayShowOpts {
  kind: SourceKind;
  label: string;
  branch?: string;
}

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
    prefill: cur.has(URL_PARAMS.SRC)
      ? { src: cur.get(URL_PARAMS.SRC)!, branch: cur.get(URL_PARAMS.BRANCH) ?? undefined }
      : undefined,
  });
}

// Apply-new-source handler. The boot wiring (sourcePickerBridge) registers the
// function that actually fetches + applies a source — it needs the live scene
// and live-update handles. The picker UI calls submitNewSource(); no window
// globals. Same register/invoke shape as stores/manifest's refreshManifest.
let _sourceApplier: ((payload: SourcePayload) => void) | null = null;

/** Register the apply-new-source handler; returns an unregister fn. */
export function registerSourceApplier(fn: (payload: SourcePayload) => void): () => void {
  if (_sourceApplier && _sourceApplier !== fn) {
    // Re-registration (e.g. HMR or a second boot) would strand the previous
    // applier — its unregister becomes a no-op once overwritten. Warn so the
    // double-install is visible rather than silently routing to a stale handle.
    console.warn('[uiState] source applier re-registered; overwriting the previous one');
  }
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

import { LoadingStep } from '@/constants/loadingSteps';

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
  const initialStep: LoadingStep = opts.kind === SourceKind.Local ? LoadingStep.Scanning : LoadingStep.Resolving;
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
