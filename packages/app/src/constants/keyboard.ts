// constants/keyboard.ts — every shortcut this app documents: the city's own,
// plus the ones it adds around them, so the panel lists one set.

import { CITY_KEY_BINDINGS, type KeyBinding } from '@codecity/city';

export { TEXT_INPUT_TAGS, type KeyBinding } from '@codecity/city';

export const KEY_BINDINGS: Record<string, KeyBinding> = {
  // The canvas answers these itself; they are listed here so the shortcuts
  // panel can show them beside the app's own.
  ...CITY_KEY_BINDINGS,
  /** Open the shortcuts panel, whose own button is one glyph in the footer. */
  SHOW_SHORTCUTS: { label: '?', keys: ['?'] },
};
