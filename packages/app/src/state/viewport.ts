// state/viewport.ts — what shape of device is looking at the app.
// Signals, not a listener per component: several places key off these and
// independent listeners answer differently mid-resize.

import { signal, type ReadonlySignal } from '@preact/signals';
import { PHONE_QUERY, COARSE_POINTER_QUERY } from '@/constants/breakpoints';

function mediaSignal(query: string): ReadonlySignal<boolean> {
  const mql = window.matchMedia?.(query);
  const state = signal(mql?.matches ?? false);
  // Optional: jsdom's matchMedia returns a list with no event target.
  mql?.addEventListener?.('change', (e) => {
    state.value = e.matches;
  });
  return state;
}

/** Too narrow for a pane to share the row with the city. */
export const IS_PHONE = mediaSignal(PHONE_QUERY);

/** Pointer is a finger, at any width — a tablet is not a phone. */
export const IS_TOUCH = mediaSignal(COARSE_POINTER_QUERY);
