// constants/dom.ts — Shared DOM-related constants.

/**
 * HTML tag names whose focus state suppresses app-level keyboard shortcuts
 * (so typing into an input doesn't trigger a focus/reset/clear key).
 * Matches Element.tagName, which is uppercase for HTML elements.
 */
export const TEXT_INPUT_TAGS: readonly string[] = ['INPUT', 'TEXTAREA'];
