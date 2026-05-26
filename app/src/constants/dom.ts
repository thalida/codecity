// constants/dom.ts — Top-level DOM element IDs the renderer + views target.

export const DOM_IDS = {
  CANVAS: 'city',
  TREE_SIDEBAR: 'tree-sidebar',
  FILE_SIDEBAR: 'sidebar',
  HOVER_TOOLTIP: 'hover-tooltip',
  APP_TITLE: 'app-title',
} as const;

/**
 * HTML tag names whose focus state suppresses app-level keyboard shortcuts
 * (so typing into an input doesn't trigger a focus/reset/clear key).
 * Matches Element.tagName, which is uppercase for HTML elements.
 */
export const TEXT_INPUT_TAGS: readonly string[] = ['INPUT', 'TEXTAREA'];
