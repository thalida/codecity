// views/CityView/state/sidebar.tsx — the chrome around ONE city: which pane,
// whether it is collapsed, whether the details are put away. Per city, because
// two side by side each have their own and a module signal would make one win.

import { createContext, type ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals';
import { Compass, Info, Search, Settings2, type LucideIcon } from 'lucide-preact';

import { IS_PHONE } from '@/state/viewport';

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
