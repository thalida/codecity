// state/stores/sidebars.ts — what each sidebar is showing: the left one's tab
// and collapse, the right one's put-away state. Lifted out of the sidebars so
// anything can send you to a pane rather than growing its own copy of that.

import { signal } from '@preact/signals';
import { DEFAULT_SIDEBAR_TAB } from '@/constants/ui';
import { SidebarTab } from '@/types/ui';

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

// ── The right sidebar's selection pane ──

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
