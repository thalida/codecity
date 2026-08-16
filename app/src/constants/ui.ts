// constants/ui.ts — UI metadata that isn't user-tunable.

import { Compass, Search, Info, Settings2, type LucideIcon } from 'lucide-preact';
import { SidebarTab } from '@/types/ui';

/** Max number of recently-opened sources kept in the source-picker MRU list
 *  (oldest dropped past this). */
export const MAX_RECENT_SOURCES = 10;

/** The codecity repo itself, base for the header's "about" link and the
 *  README-anchor deep links used elsewhere in the UI. */
export const REPO_URL = 'https://github.com/thalida/codecity';

/** README anchors deep-linked from more than one surface. */
export const LOCAL_DOCS_URL = `${REPO_URL}#local-directories`;
export const EXCLUDES_DOCS_URL = `${REPO_URL}#skipped-by-default`;

/** The author's site, linked from the footer credit. */
export const CREATOR_URL = 'https://thalida.com';

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
