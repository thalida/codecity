// constants/ui.ts — UI metadata that isn't user-tunable.

import { FolderTree, Search, Info, Settings2, type LucideIcon } from 'lucide-preact';
import { SidebarTab } from '@/types/ui';

/** Max number of recently-opened sources kept in the source-picker MRU list
 *  (oldest dropped past this). */
export const MAX_RECENT_SOURCES = 10;

/**
 * Activity-bar tab definitions (left-side icon strip). Each entry pairs a tab
 * id with its Lucide glyph component (imported from lucide-preact) + the
 * tooltip title. `placement` splits the bar into a top group and a bottom
 * group — top entries stack from the top, bottom entries pin to the bottom.
 * Not designer-tunable — part of the app's structural definition.
 */
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
  // with (see LeftSidebar's default tab + on-load switch).
  { id: SidebarTab.Info, icon: Info, title: 'Info' },
  { id: SidebarTab.Tree, icon: FolderTree, title: 'Tree' },
  { id: SidebarTab.Search, icon: Search, title: 'Search' },
  { id: SidebarTab.Controls, icon: Settings2, title: 'Settings', placement: TabPlacement.Bottom },
] as const;
