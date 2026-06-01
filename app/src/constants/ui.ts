// constants/ui.ts — UI metadata that isn't user-tunable.

import { SidebarTab } from '@/types/ui';

/**
 * Lucide icon base path. Tree glyphs, activity-bar tabs, and the sidebar
 * close button reference per-icon SVG filenames relative to this URL. The
 * icons are vendored under app/public/icons/lucide/ (copied from the pinned
 * lucide-static devDependency) and served by the app itself — no runtime CDN
 * dependency, so the local Docker tool works offline and can't be surprised by
 * an upstream icon rename. The icons-exist guard test keeps the vendored set
 * in sync with the names referenced in code.
 */
export const LUCIDE_ICON_BASE_URL = '/icons/lucide/';

/** Max number of recently-opened sources kept in the source-picker MRU list
 *  (oldest dropped past this). */
export const MAX_RECENT_SOURCES = 10;

/**
 * Activity-bar tab definitions (left-side icon strip). Each entry maps
 * a tab id to the Lucide icon filename + the tooltip title. `placement`
 * splits the bar into a top group and a bottom group — top entries
 * stack from the top of the bar, bottom entries pin to the bottom.
 * Not designer-tunable — part of the app's structural definition.
 */
export interface ActivityBarTab {
  id: SidebarTab;
  icon: string;
  title: string;
  placement?: 'top' | 'bottom';
}

export const ACTIVITY_BAR_TABS: readonly ActivityBarTab[] = [
  { id: SidebarTab.Tree, icon: 'folder-tree.svg', title: 'Tree' },
  { id: SidebarTab.Search, icon: 'search.svg', title: 'Search' },
  { id: SidebarTab.Info, icon: 'info.svg', title: 'Info' },
  { id: SidebarTab.Controls, icon: 'settings-2.svg', title: 'Settings', placement: 'bottom' },
] as const;
