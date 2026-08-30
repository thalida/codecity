// views/CityView/chrome.tsx — what this view shows around its city: the modals,
// the loading overlay, the freshness readout, and the sidebar state.
//
// Two scopes. Modals are app-wide (one keyboard); the rest is per city.

import { createContext, type ComponentChildren } from 'preact';
import { Compass, Info, Search, Settings2, type LucideIcon } from 'lucide-preact';
import { useContext, useMemo } from 'preact/hooks';
import { signal, computed, type Signal } from '@preact/signals';

import { IS_PHONE } from '@/state/viewport';
import { ON_HOME } from '@/router/paths';
import type { CityStatus } from '@codecity/city';
import { CityLifecycle, CityPhase, SourceKind } from '@codecity/city';
import {
  LoadingStep,
  LOADING_STEPS,
  firstStepFor,
  countsTail,
  buildStageTail,
} from '@/constants/progress';

// ── What the chrome is made of ───────────────────────────────────────

/** Left-sidebar tab IDs. Discriminator on the activity bar's mounted pane. */
export enum SidebarTab {
  Explore = 'explore',
  Search = 'search',
  Info = 'info',
  Controls = 'controls',
}

/** The activity bar's tabs: id, glyph, tooltip, and which end of the strip
 *  each pins to. Structural, not designer-tunable. */
/** Which group of the activity bar a tab pins to. Default (unset) is Top. */
export enum TabPlacement {
  Top = 'top',
  Bottom = 'bottom',
}

export interface ActivityBarTab {
  id: SidebarTab;
  /** Lucide glyph component (lucide-preact). */
  icon: LucideIcon;
  title: string;
  placement?: TabPlacement;
}

export const ACTIVITY_BAR_TABS: readonly ActivityBarTab[] = [
  // Info leads: the almanac is the first thing a freshly-loaded world greets you
  // with (see DEFAULT_SIDEBAR_TAB + CitySidebarLeft's on-load switch).
  { id: SidebarTab.Info, icon: Info, title: 'Info' },
  { id: SidebarTab.Explore, icon: Compass, title: 'Explore' },
  { id: SidebarTab.Search, icon: Search, title: 'Search' },
  { id: SidebarTab.Controls, icon: Settings2, title: 'Settings', placement: TabPlacement.Bottom },
] as const;

/** The left sidebar's default active tab — the one shown on first paint and
 *  re-opened whenever a world loads. Info (the almanac) leads the rail. */
export const DEFAULT_SIDEBAR_TAB: SidebarTab = SidebarTab.Info;

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

// ── App-wide: the modals ─────────────────────────────────────────────

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

// ── Per city: the chrome around one ──────────────────────────────────

export interface CityChromeState {
  tab: Signal<SidebarTab>;
  collapsed: Signal<boolean>;
  /** Whether the current selection's details are put away. */
  detailsDismissed: Signal<boolean>;
  /** Put the details away, leaving the node selected and outlined. */
  dismissDetails(): void;
  /** Bring the details back for a node that is already selected. */
  openDetails(): void;
  /** Focusing is asking to LOOK at something, so it clears what is in the way. */
  revealCity(): void;
  /** You asked for the node by name, so its details are the answer. */
  revealDetails(): void;
}

export function createCityChrome(): CityChromeState {
  const tab = signal<SidebarTab>(DEFAULT_SIDEBAR_TAB);
  const collapsed = signal<boolean>(true);
  const detailsDismissed = signal(false);

  // Phone: the left drawer covers the city, so a camera move behind it is one
  // you cannot see. It is the whole screen there and a column everywhere else.
  const collapseDrawerOnPhone = () => {
    if (IS_PHONE.peek()) collapsed.value = true;
  };

  return {
    tab,
    collapsed,
    detailsDismissed,
    dismissDetails: () => void (detailsDismissed.value = true),
    openDetails: () => void (detailsDismissed.value = false),
    revealCity: () => {
      detailsDismissed.value = true;
      collapseDrawerOnPhone();
    },
    revealDetails: () => {
      detailsDismissed.value = false;
      collapseDrawerOnPhone();
    },
  };
}

const Ctx = createContext<CityChromeState | null>(null);

export function CityChromeProvider({ children }: { children: ComponentChildren }) {
  const chrome = useMemo(createCityChrome, []);
  return <Ctx.Provider value={chrome}>{children}</Ctx.Provider>;
}

/** The chrome around the city this subtree is about. Detached outside a
 *  provider, so a component on its own still works rather than throwing. */
export function useCityChrome(): CityChromeState {
  const fallback = useMemo(createCityChrome, []);
  return useContext(Ctx) ?? fallback;
}

/** What THIS app asked for, which it knows before the city reports anything:
 *  a local path skips the rows a remote source runs, and the branch is in the */
export interface LoadingSource {
  kind: SourceKind;
  branch?: string;
}

// ── What the app adds to it ─────────────────────────────────────────
// Two facts the city has no event for, because neither is about the city: a

/** Work THIS app is doing that no city is reporting, and failures of it. Three
 *  cases, all genuinely the host's: a Save the city answers by refreshing */
export interface HostWork {
  busy: boolean;
  error: unknown | null;
}

export const HOST_WORK = signal<HostWork>({ busy: false, error: null });

export function beginHostWork(): void {
  HOST_WORK.value = { busy: true, error: null };
}

export function endHostWork(): void {
  if (!HOST_WORK.peek().busy) return;
  HOST_WORK.value = { busy: false, error: null };
  LAST_UPDATED_AT.value = Date.now();
}

export function failHostWork(error: unknown): void {
  // Logged with the stack, where a developer can use it. The UI shows a generic
  // line: the message names our internals, and a reader cannot act on it.
  console.error('[codecity] the app could not finish what it started', error);
  HOST_WORK.value = { busy: false, error };
  REBUILD_DETAIL.value = null;
}

/** Epoch millis of the most recent finished build. The city says it is Ready;
 *  how long ago that was is the reader's question, not the city's. */
export const LAST_UPDATED_AT = signal<number>(0);

/** How far along a rebuild that has no overlay above it (Timeline refetching a
 *  bundle under an exclude edit) — the one build nothing else reports. */
export const REBUILD_DETAIL = signal<string | null>(null);

export function setRebuildDetail(detail: string | null): void {
  REBUILD_DETAIL.value = detail;
}

// ── What the overlay shows ───────────────────────────────────────────

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

// ── Where a build's own reports come in ──────────────────────────────

/** Keep the app's own two facts in step with one city's status: what the
 *  finished city was built from, and when it finished. The SCENE city's only — */
export function createBuildReport(initial: CityStatus): (status: CityStatus) => void {
  let wasReady = initial.lifecycle === CityLifecycle.Ready;
  return (status: CityStatus) => {
    const ready = status.lifecycle === CityLifecycle.Ready;
    if (ready && !wasReady) {
      LAST_UPDATED_AT.value = Date.now();
      REBUILD_DETAIL.value = null;
    }
    wasReady = ready;
    if (status.lifecycle === CityLifecycle.Error) {
      // Logged with the stack, where a developer can use it. The UI shows a
      // generic line: the message names our internals, and a reader cannot act
      console.error('[codecity] city build failed', status.error);
      REBUILD_DETAIL.value = null;
    }
  };
}
