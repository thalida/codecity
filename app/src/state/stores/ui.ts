// state/stores/ui.ts — Signals controlling global modal/overlay
// visibility. Components read these to show/hide themselves; callers
// write them to open/close. Replaces the imperative `picker.open()` /
// `loadingOverlay.show()` boot-time pattern.

import { signal, computed } from '@preact/signals';
import { SourceKind } from '@/utils/sources';
import { DEFAULT_SIDEBAR_TAB } from '@/constants/ui';
import { ROUTES } from '@/constants/routes';
import { ROUTE_PATH, navigate } from '@/state/route';
import { SidebarTab } from '@/types/ui';
import type { ScanErrorCode } from '@/api/manifest';

// The contracts the views render against. They live in state/ so state stays
// view-independent: the components import them, never the reverse.

/** What the source picker submits when the user opens a project. */
export interface SourcePayload {
  src: string;
  branch?: string;
  /** When true, this open forces a fresh scan (server-side ?no_cache=1).
   *  Not persisted — re-opening from a recent uses cached scan by default. */
  skipCache?: boolean;
}

/** What to tell the landing when something sends you there: what to prefill,
 *  and what went wrong. Not visibility, which is the route. */
export interface HomeOpts {
  prefill?: SourcePayload;
  error?: string;
  /** The failure's machine-readable reason, where the server gave one, so the
   *  form can offer a remedy instead of only echoing the message. */
  errorCode?: ScanErrorCode;
}

/** Options for showing the loading overlay. */
export interface LoadingOverlayShowOpts {
  kind: SourceKind;
  branch?: string;
  // Custom step list (e.g. Timeline-mode entry). Defaults to LOADING_STEPS.
  steps?: readonly LoadingStep[];
}

// ── Home (the landing / project switcher) ────────────────────────────────────

/** The landing IS home: it shows because of where you are, not because a flag
 *  says so, which is what makes back/forward land on it correctly. */
export const ON_HOME = computed(() => ROUTE_PATH.value === ROUTES.HOME);

export const HOME_OPTS = signal<HomeOpts>({});

/** Go to the landing. A destination the user asked for, so it pushes: Back is
 *  how you return to the city, which is why the view has no close button. */
export function goHome(opts: HomeOpts = {}): void {
  HOME_OPTS.value = opts;
  navigate(ROUTES.HOME);
}

/** Drop a stale error banner without disturbing the prefill. No-ops with no
 *  error, so it is cheap on every keystroke. */
export function clearHomeError(): void {
  const prev = HOME_OPTS.peek();
  if (!prev.error) return;
  HOME_OPTS.value = { ...prev, error: undefined, errorCode: undefined };
}

// ── Left sidebar ─────────────────────────────────────────────────────────────

/** Which left pane is mounted, lifted out of the sidebar so anything can send
 *  you to one rather than growing its own copy of that control. */
export const SIDEBAR_TAB = signal<SidebarTab>(DEFAULT_SIDEBAR_TAB);
export const SIDEBAR_COLLAPSED = signal<boolean>(true);

/** Open the sidebar on a pane. Already there and open: no-op, rather than
 *  toggling shut, so a caller that means "show me this" always shows it. */
export function openSidebarTab(tab: SidebarTab): void {
  SIDEBAR_TAB.value = tab;
  SIDEBAR_COLLAPSED.value = false;
}

// ── Selection pane (right sidebar) ───────────────────────────────────────────

/** Whether the current selection's details are put away. Cleared whenever the
 *  selection changes, so coming back to a node always shows them again. */
export const SELECTION_PANE_DISMISSED = signal(false);

/** Put the details away, leaving the node selected (and outlined in the city). */
export function dismissSelectionPane(): void {
  SELECTION_PANE_DISMISSED.value = true;
}

/** Bring the details back for a node that is already selected. */
export function openSelectionPane(): void {
  SELECTION_PANE_DISMISSED.value = false;
}

// ── Loading overlay ──────────────────────────────────────────────────────────

import { LoadingStep, LOADING_STEPS, firstStepFor } from '@/constants/loadingSteps';

/** Repo name in the loading overlay's header, shown before the manifest lands.
 *  Overlay-owned: showLoadingOverlay/hideLoadingOverlay control its lifetime. */
export const PENDING_SOURCE_LABEL = signal<string | null>(null);

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

/** True when something else owns the keyboard: a modal, or the landing, whose
 *  backdrop canvas would otherwise answer keystrokes meant for its form. */
export const OVERLAY_OPEN = computed(
  () => ON_HOME.value || SHORTCUTS_OPEN.value || DEBUG_OPEN.value
);
