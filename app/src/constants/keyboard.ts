// constants/keyboard.ts — the KeyboardEvent.key values that act as app-level
// shortcuts, and where they must not fire. Centralized so the input handler and
// the shortcuts panel documenting it cannot drift apart.

/** Tags whose focus suppresses every shortcut below, so typing an "r" into a
 *  field does not reset the camera. Matches the uppercase Element.tagName. */
export const TEXT_INPUT_TAGS: readonly string[] = ['INPUT', 'TEXTAREA'];

/** One binding: a primary key plus aliases (case, and 'Home' for reset). */
export interface KeyBinding {
  /** Display label shown in the help table (one entry per visual key). */
  label: string;
  /** All KeyboardEvent.key values that fire this action. */
  keys: readonly string[];
}

export const KEY_BINDINGS: Record<string, KeyBinding> = {
  /** Reset the framing to the mode's default pose, as clicking the gem does.
   *  Does NOT rebuild the manifest: reload the page for that. */
  RESET_VIEW: { label: 'R', keys: ['r', 'R', 'Home'] },
  /** Focus camera on the current selection. */
  FOCUS_SELECTION: { label: 'F', keys: ['f', 'F'] },
  /** Close the sidebar / clear selection. */
  CLEAR_SELECTION: { label: 'Esc', keys: ['Escape'] },
  /** Open the shortcuts panel, whose own button is one glyph in the footer. */
  SHOW_SHORTCUTS: { label: '?', keys: ['?'] },
};
