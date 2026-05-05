// constants/ui.ts — UI metadata that isn't user-tunable.

import { SidebarTab } from '../types/ui';

/**
 * Lucide icon CDN base. Tree glyphs, activity-bar tabs, and the sidebar
 * close button all reference per-icon SVG filenames relative to this URL.
 */
export const LUCIDE_ICON_BASE_URL = 'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/';

/**
 * Activity-bar tab definitions (left-side icon strip). Each entry maps
 * a tab id to the Lucide icon filename + the tooltip title. Not
 * designer-tunable — these are part of the app's structural definition.
 */
export interface ActivityBarTab {
  id: SidebarTab;
  icon: string;
  title: string;
}

export const ACTIVITY_BAR_TABS: readonly ActivityBarTab[] = [
  { id: SidebarTab.Tree, icon: 'folder-tree.svg', title: 'Tree' },
  { id: SidebarTab.Info, icon: 'info.svg', title: 'Info' },
  { id: SidebarTab.Controls, icon: 'sliders-horizontal.svg', title: 'Controls' },
] as const;
