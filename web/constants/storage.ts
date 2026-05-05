// constants/storage.ts — localStorage key constants. Centralized so
// reading or writing a key from a new place doesn't risk a typo
// silently splitting state across two slots.
//
// Persistence prefix is shared across all keys so a one-shot grep on
// `cc.` finds every codecity-owned localStorage entry. config/persist.ts
// adds its own per-store keys with the same prefix.

export const STORAGE_PREFIX = 'cc.';

export const STORAGE_KEYS = {
  /** Camera position + target, debounced-saved on every controls 'change'. */
  CAMERA_POSE: 'cc.cameraPose',
  /** Right (file-preview) sidebar drag-handle width in px. */
  FILE_SIDEBAR_WIDTH: 'cc.fileSidebarWidth',
  /** Left (tree/info/controls) sidebar drag-handle width in px. */
  SIDEBAR_WIDTH: 'cc.sidebarWidth',
  /** Left sidebar collapsed state ('true' iff collapsed). */
  SIDEBAR_COLLAPSED: 'cc.sidebarCollapsed',
  /** Header toggle: left sidebar entirely hidden. */
  APP_LEFT_HIDDEN: 'cc.appLeftHidden',
  /** Header toggle: right sidebar entirely hidden. */
  APP_RIGHT_HIDDEN: 'cc.appRightHidden',
} as const;
