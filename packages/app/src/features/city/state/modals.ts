// features/city/state/modals.ts — which modal is up, and whether something
// other than the city owns the keyboard. App-wide: one keyboard, one layer.

import { signal, computed } from '@preact/signals';
import { ON_HOME } from '@/router/location';

/** Whether the keyboard/mouse shortcuts reference modal is open. */
export const SHORTCUTS_OPEN = signal(false);

/** Open the shortcuts modal (header `?` icon). */
export function openShortcuts(): void {
  SHORTCUTS_OPEN.value = true;
}

/** Whether the developer-diagnostics modal is open. */
export const DEBUG_OPEN = signal(false);

/** True when something else owns the keyboard: a modal, or the landing, whose
 *  backdrop canvas would otherwise answer keystrokes meant for its form. */
export const OVERLAY_OPEN = computed(
  () => ON_HOME.value || SHORTCUTS_OPEN.value || DEBUG_OPEN.value
);
