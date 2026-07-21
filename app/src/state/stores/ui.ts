// state/stores/ui.ts — Signals controlling global modal/overlay
// visibility. Components read these to show/hide themselves; callers
// write them to open/close. Replaces the imperative `picker.open()` /
// `loadingOverlay.show()` boot-time pattern.

import { signal, computed } from '@preact/signals';
import { SourceKind } from '@/utils/sources';

// These are the UI-state CONTRACTS the views render against. They live here (in
// state) so state/ stays view-independent — the ProjectsView / LoadingOverlay
// components import them from here, not the other way around.

/** What the source picker submits when the user opens a project. */
export interface SourcePayload {
  src: string;
  branch?: string;
  /** set only for a time-travel jump; absent for a normal load */
  ref?: string;
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
  branch?: string;
}

// ── Projects view ────────────────────────────────────────────────────────────

export interface ProjectsViewState {
  visible: boolean;
  opts: OpenOpts;
}

export const PROJECTS_VIEW = signal<ProjectsViewState>({
  visible: false,
  opts: {},
});

/** Open the projects view. */
export function openProjectsView(opts: OpenOpts = {}): void {
  PROJECTS_VIEW.value = { visible: true, opts };
}

/** Close the projects view. Reads the prior state with .peek() (not .value):
 *  App's committed-source reaction calls this from inside a useSignalEffect, and
 *  a tracked .value read would subscribe that effect to PROJECTS_VIEW — so
 *  opening the view (while a city is loaded, CURRENT_SOURCE truthy) would
 *  re-fire the effect and close the view right back. peek() keeps the reaction
 *  keyed on CURRENT_SOURCE alone. Mirrors the LOADING_OVERLAY setters. */
export function closeProjectsView(): void {
  PROJECTS_VIEW.value = { ...PROJECTS_VIEW.peek(), visible: false };
}

/** True while the switcher is open OVER a loaded city (the dismissible / modal
 *  case) — the only case with a city behind it to turn into a backdrop. Drives
 *  the showcase: chrome hidden, camera into a hero turntable (useSwitcherShowcase).
 *  The non-dismissible full-page boot has no city behind, so it stays false. */
export const SWITCHER_SHOWCASE = computed(
  () => PROJECTS_VIEW.value.visible && PROJECTS_VIEW.value.opts.dismissible === true
);

/** Drop a stale open-error banner (e.g. once the user edits the source), leaving
 *  the view open and its prefill intact. No-ops when there's no error so it's
 *  cheap to call on every keystroke. peek() to avoid subscribing callers. */
export function clearProjectsViewError(): void {
  const prev = PROJECTS_VIEW.peek();
  if (!prev.opts.error) return;
  PROJECTS_VIEW.value = { ...prev, opts: { ...prev.opts, error: undefined } };
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

/** True while any modal (projects view, shortcuts, debug) is open. Scene input
 *  handlers read this so keyboard shortcuts don't fire underneath a modal. */
export const MODAL_OPEN = computed(
  () => PROJECTS_VIEW.value.visible || SHORTCUTS_OPEN.value || DEBUG_OPEN.value
);
