// constants/storage.ts — localStorage key constants. Centralized so
// reading or writing a key from a new place doesn't risk a typo
// silently splitting state across two slots.
//
// Persistence prefix is shared across all keys so a one-shot grep on
// `cc.` finds every codecity-owned localStorage entry. config/persist.ts
// adds its own per-store keys with the same prefix.

export const STORAGE_PREFIX = 'cc.';

export const STORAGE_KEYS = {
  /** Right (file-preview) sidebar drag-handle width in px. */
  FILE_SIDEBAR_WIDTH: `${STORAGE_PREFIX}fileSidebarWidth`,
  /** Left (tree/info/controls) sidebar drag-handle width in px. */
  SIDEBAR_WIDTH: `${STORAGE_PREFIX}sidebarWidth`,
  /** Left sidebar collapsed state ('true' iff collapsed). */
  SIDEBAR_COLLAPSED: `${STORAGE_PREFIX}sidebarCollapsed`,
} as const;

/** Base keys for persistedSignal()-backed stores. Unlike STORAGE_KEYS above
 *  (raw localStorage access, fully-qualified with STORAGE_PREFIX), these are
 *  BARE suffixes — persistedSignal() prepends STORAGE_PREFIX itself, so the
 *  effective slot is e.g. `cc.recents`. */
export const PERSISTED_KEYS = {
  /** Recently-opened sources list (source-picker MRU). */
  RECENTS: 'recents',
} as const;
