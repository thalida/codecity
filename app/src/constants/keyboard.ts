// constants/keyboard.ts — KeyboardEvent.key values that act as
// app-level shortcuts. Centralized so the input handler and the
// help table in the Controls pane can't drift apart.

/**
 * One shortcut binding: a primary key + optional aliases (e.g. lowercase
 * plus uppercase, plus 'Home' as a synonym for reset).
 */
export interface KeyBinding {
  /** Display label shown in the help table (one entry per visual key). */
  label: string;
  /** All KeyboardEvent.key values that fire this action. */
  keys: readonly string[];
}

export const KEY_BINDINGS: Record<string, KeyBinding> = {
  /** Reset the camera framing to the current mode's default pose.
   *  Mirrors clicking the gem in the city.
   *  Does NOT rebuild the city manifest — reload the page for that. */
  RESET_VIEW: { label: 'R', keys: ['r', 'R', 'Home'] },
  /** Focus camera on the current selection. */
  FOCUS_SELECTION: { label: 'F', keys: ['f', 'F'] },
  /** Close the sidebar / clear selection. */
  CLEAR_SELECTION: { label: 'Esc', keys: ['Escape'] },
  /** Open the keyboard-shortcuts panel. Its button lives in the 24px footer
   *  now, so the panel needs a way in that doesn't depend on finding it. */
  SHOW_SHORTCUTS: { label: '?', keys: ['?'] },
};
