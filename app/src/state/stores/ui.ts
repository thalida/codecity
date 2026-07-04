// state/stores/ui.ts — Signals controlling global modal/overlay
// visibility. Components read these to show/hide themselves; callers
// write them to open/close. Replaces the imperative `picker.open()` /
// `loadingOverlay.show()` boot-time pattern.

import { signal, computed } from '@preact/signals';
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

// ── Loading overlay ──────────────────────────────────────────────────────────

import { LoadingStep } from '@/constants/loadingSteps';

export interface LoadingOverlayState {
  visible: boolean;
  showOpts: LoadingOverlayShowOpts | null;
  activeStep: LoadingStep | null;
  stepTails: Partial<Record<LoadingStep, string | null>>;
}

export const LOADING_OVERLAY = signal<LoadingOverlayState>({
  visible: false,
  showOpts: null,
  activeStep: null,
  stepTails: {},
});

// Setters use .peek() rather than .value to read the prior state — these
// functions are sometimes called from inside other effects (e.g. the
// REBUILD_STATUS → 'decorating' bridge), and a tracked `.value` read
// would auto-subscribe that effect to LOADING_OVERLAY, producing a cycle
// when the same effect later writes back.

export function showLoadingOverlay(opts: LoadingOverlayShowOpts): void {
  const initialStep: LoadingStep =
    opts.kind === SourceKind.Local ? LoadingStep.Scanning : LoadingStep.Resolving;
  LOADING_OVERLAY.value = {
    visible: true,
    showOpts: opts,
    activeStep: initialStep,
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

export function setLoadingStepTail(step: LoadingStep, tail: string | null): void {
  const prev = LOADING_OVERLAY.peek();
  LOADING_OVERLAY.value = {
    ...prev,
    stepTails: { ...prev.stepTails, [step]: tail },
  };
}

// ── Shortcuts modal ──────────────────────────────────────────────────────────

/** Whether the keyboard/mouse shortcuts reference modal is open. */
export const SHORTCUTS_OPEN = signal(false);

/** Open the shortcuts modal (header `?` icon). */
export function openShortcuts(): void {
  SHORTCUTS_OPEN.value = true;
}

/** Close the shortcuts modal. */
export function closeShortcuts(): void {
  SHORTCUTS_OPEN.value = false;
}

// ── Debug modal ──────────────────────────────────────────────────────────────

/** Whether the developer-diagnostics modal is open. */
export const DEBUG_OPEN = signal(false);

/** Open the debug modal (header bug icon, flag-gated). */
export function openDebug(): void {
  DEBUG_OPEN.value = true;
}

/** Close the debug modal. */
export function closeDebug(): void {
  DEBUG_OPEN.value = false;
}

/** True while any modal (source picker, shortcuts, debug) is open. Scene input
 *  handlers read this so keyboard shortcuts don't fire underneath a modal. */
export const MODAL_OPEN = computed(
  () => SOURCE_PICKER.value.visible || SHORTCUTS_OPEN.value || DEBUG_OPEN.value
);
