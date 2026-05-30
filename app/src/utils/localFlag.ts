// utils/localFlag.ts — boolean flags persisted in localStorage.
//
// Storage convention: write '1' for on, REMOVE the key for off (so a
// fresh / cleared install starts with every flag at its default and
// localStorage stays clean of "false" entries).
//
// Reads also accept the legacy 'true' encoding from earlier code so
// users with an existing `cc.sidebarCollapsed=true` don't lose state on
// first load after this consolidation; their value gets rewritten as
// '1' on the next toggle.

const ON_VALUE = '1';
const LEGACY_ON_VALUE = 'true';

/**
 * Read a boolean flag from localStorage. Returns `defaultVal` if the
 * key isn't set, if localStorage is unavailable (SSR / private mode),
 * or on any access error.
 */
export function loadFlag(key: string, defaultVal: boolean): boolean {
  if (typeof localStorage === 'undefined') return defaultVal;
  try {
    const v = localStorage.getItem(key);
    if (v == null) return defaultVal;
    return v === ON_VALUE || v === LEGACY_ON_VALUE;
  } catch (_) {
    return defaultVal;
  }
}

/**
 * Write a boolean flag to localStorage. Stores `'1'` when on; removes
 * the key when off so the default state has no entry. Silently swallows
 * quota / private-mode errors.
 */
export function saveFlag(key: string, on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (on) localStorage.setItem(key, ON_VALUE);
    else localStorage.removeItem(key);
  } catch (_) {
    /* quota / private mode — drop */
  }
}
