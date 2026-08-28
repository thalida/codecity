// state/stores/chrome.ts — what the app chrome is showing around the city:
// which left pane, whether it is collapsed, whether the selection's details are
// put away, and which modal is up. Lifted out of the components so anything can
// send you to a pane without growing its own copy of that control.

import { signal, computed } from '@preact/signals';
import { DEFAULT_SIDEBAR_TAB } from '@/constants/ui';
import { SidebarTab } from '@/types/ui';
import { ON_HOME } from '@/router/paths';

// ── The left sidebar ─────────────────────────────────────────────────

export const SIDEBAR_TAB = signal<SidebarTab>(DEFAULT_SIDEBAR_TAB);
export const SIDEBAR_COLLAPSED = signal<boolean>(true);

// ── The right sidebar's selection pane ───────────────────────────────

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

// ── Modals ───────────────────────────────────────────────────────────

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
