// state/stores/chrome.tsx — what the app chrome is showing.
//
// Two scopes, one topic. The modals are app-wide: one keyboard, one modal
// layer. What surrounds a PARTICULAR city is per city, because two side by side
// each have their own and a module signal would make one of them win.

import { createContext, type ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import { signal, computed, type Signal } from '@preact/signals';

import { DEFAULT_SIDEBAR_TAB } from '@/constants/ui';
import { SidebarTab } from '@/types/ui';
import { IS_PHONE } from '@/state/stores/viewport';
import { ON_HOME } from '@/router/paths';

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
