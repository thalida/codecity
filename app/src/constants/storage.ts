// constants/storage.ts — localStorage key constants. Centralized so
// reading or writing a key from a new place doesn't risk a typo
// silently splitting state across two slots.
//
// Persistence prefix is shared across all keys so a one-shot grep on
// `cc.` finds every codecity-owned localStorage entry. state/persist.ts
// adds its own per-store keys with the same prefix.

export const STORAGE_PREFIX = 'cc.';

/** Bare keys for persistedSignal()-backed stores. These are BARE suffixes —
 *  persistedSignal() prepends STORAGE_PREFIX itself, so the effective slot is
 *  e.g. `cc.recents`. All persisted UI/session state flows through here; there
 *  is no separate raw-localStorage key table. */
export const PERSISTED_KEYS = {
  /** Recently-opened sources list (source-picker MRU). */
  RECENTS: 'recents',
  /** Left (tree/info/controls) sidebar drag-handle width in px. */
  LEFT_SIDEBAR_WIDTH: 'leftSidebarWidth',
  /** Right (file/commit/street pane) sidebar drag-handle width in px. */
  RIGHT_SIDEBAR_WIDTH: 'rightSidebarWidth',
  /** Per-repo UI exclude lists (repo key -> rel-paths hidden from the city). */
  EXCLUDES: 'excludes',
} as const;
