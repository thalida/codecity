// state/stores/ui.ts — Signals controlling global modal/overlay
// visibility. Components read these to show/hide themselves; callers
// write them to open/close. Replaces the imperative `picker.open()` /
// `loadingOverlay.show()` boot-time pattern.

import { signal, computed } from '@preact/signals';
import { SourceKind } from '@/utils/sources';
import { DEFAULT_SIDEBAR_TAB } from '@/constants/ui';
import { ROUTES } from '@/constants/routes';
import { HREF, ROUTE_PATH, navigate } from '@/state/route';
import { CURRENT_SOURCE } from '@/state/stores/source';
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

/** Options for opening the source picker. Whether it can be dismissed is NOT
 *  among them: that is whether a city is loaded (see SWITCHER_DISMISSIBLE). */
export interface OpenOpts {
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

// ── Projects view ────────────────────────────────────────────────────────────

/** The switcher IS home: it shows because of where you are, not because a flag
 *  says so, which is what makes back/forward land on it correctly. */
export const ON_HOME = computed(() => ROUTE_PATH.value === ROUTES.HOME);

/** Per-open extras: what to prefill, what went wrong. Not visibility. */
export const PROJECTS_VIEW_OPTS = signal<OpenOpts>({});

/** Dismissible when there is a city to go back to. Derived, not passed in: a
 *  browser Back onto home has no caller to say which kind of open it is. */
export const SWITCHER_DISMISSIBLE = computed(() => CURRENT_SOURCE.value !== null);

/** The switcher over a loaded city: the only case with something behind it to
 *  turn into a backdrop, which is what drives the showcase. */
export const SWITCHER_SHOWCASE = computed(() => ON_HOME.value && SWITCHER_DISMISSIBLE.value);

/** Where the switcher was opened from, so dismissing returns to the exact view
 *  it covered (mode, scrub commit and selection included). */
const COVERED_HREF = signal<string | null>(null);

/** Go to the switcher. A destination the user asked for, so it pushes. */
export function openProjectsView(opts: OpenOpts = {}): void {
  PROJECTS_VIEW_OPTS.value = opts;
  const here = HREF.peek();
  if (here !== ROUTES.HOME) COVERED_HREF.value = here;
  navigate(ROUTES.HOME);
}

/** Leave the switcher for the view it covered. peek throughout: reactions call
 *  this from inside effects, where tracking would feed back on itself. */
export function closeProjectsView(): void {
  // Nothing loaded means nothing to go back TO, whatever we were covering when
  // the last city was dropped: leaving would land on a /city with no project.
  if (!SWITCHER_DISMISSIBLE.peek()) return;
  const covered = COVERED_HREF.peek();
  if (covered) navigate(covered);
}

/** Drop a stale error banner without disturbing the prefill. No-ops with no
 *  error, so it is cheap on every keystroke. */
export function clearProjectsViewError(): void {
  const prev = PROJECTS_VIEW_OPTS.peek();
  if (!prev.error) return;
  PROJECTS_VIEW_OPTS.value = { ...prev, error: undefined, errorCode: undefined };
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

/** True while any modal (projects view, shortcuts, debug) is open. Scene input
 *  handlers read this so keyboard shortcuts don't fire underneath a modal. */
export const OVERLAY_OPEN = computed(
  () => ON_HOME.value || SHORTCUTS_OPEN.value || DEBUG_OPEN.value
);
