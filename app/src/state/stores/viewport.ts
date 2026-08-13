// state/stores/viewport.ts — what shape of device is looking at the app.
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

/** Root class + custom property the shell's height reads. Set together, so the
 *  stylesheet can only opt in once there is a real measurement to opt into. */
const VIEWPORT_HEIGHT_CLASS = 'cc-has-viewport-h';
const VIEWPORT_HEIGHT_PROP = '--cc-viewport-h';

/**
 * Publish the height actually on screen, because dvh doesn't here.
 *
 * dvh tracks the mobile browser's own chrome retracting, but the app root never
 * scrolls (html/body are overflow:hidden so a pane scrolls instead of the page).
 * Scrolling one of those panes can still retract the toolbar, and dvh is left a
 * toolbar's height short: the shell then sits above the bottom of the screen.
 * visualViewport reports what is visible and fires when browser chrome moves.
 *
 * Ignores a pinch-zoom, where visualViewport is the zoomed-in slice of the page
 * rather than a smaller window, and relaying the shell to it would fight the
 * gesture. Returns a teardown for symmetry with the app's other listeners.
 */
export function trackViewportHeight(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  const apply = (): void => {
    if (viewport.scale > 1) return; // pinch-zoomed: not a change of window size
    const root = document.documentElement;
    root.style.setProperty(VIEWPORT_HEIGHT_PROP, `${viewport.height}px`);
    root.classList.add(VIEWPORT_HEIGHT_CLASS);
  };

  apply();
  viewport.addEventListener('resize', apply);
  return () => {
    viewport.removeEventListener('resize', apply);
    document.documentElement.classList.remove(VIEWPORT_HEIGHT_CLASS);
    document.documentElement.style.removeProperty(VIEWPORT_HEIGHT_PROP);
  };
}
