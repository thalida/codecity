// constants/storage.ts — localStorage key constants. Centralized so
// reading or writing a key from a new place doesn't risk a typo
// silently splitting state across two slots.
//
// Persistence prefix is shared across all keys so a one-shot grep on
// `cc.` finds every codecity-owned localStorage entry. config/persist.ts
// adds its own per-store keys with the same prefix.

export const STORAGE_PREFIX = 'cc.';

/** Per-source key namespace: `cc.source.<sourceKey>.<baseName>`. Used by
 *  persistAtomPerSource so each loaded source gets isolated localStorage
 *  slots for selection, camera pose, etc. */
export const STORAGE_PER_SOURCE_PREFIX = `${STORAGE_PREFIX}source.`;

export const STORAGE_KEYS = {
  /** Camera position + target, debounced-saved on every controls 'change'. */
  CAMERA_POSE: `${STORAGE_PREFIX}cameraPose`,
  /** Right (file-preview) sidebar drag-handle width in px. */
  FILE_SIDEBAR_WIDTH: `${STORAGE_PREFIX}fileSidebarWidth`,
  /** Left (tree/info/controls) sidebar drag-handle width in px. */
  SIDEBAR_WIDTH: `${STORAGE_PREFIX}sidebarWidth`,
  /** Left sidebar collapsed state ('true' iff collapsed). */
  SIDEBAR_COLLAPSED: `${STORAGE_PREFIX}sidebarCollapsed`,
} as const;
