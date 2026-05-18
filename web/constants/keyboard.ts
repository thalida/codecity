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
  /** Refresh — rebuild the city manifest AND reset the camera framing.
   *  Mirrors the header gem button and clicking the gem in the city. */
  RESET_VIEW: { label: 'R', keys: ['r', 'R', 'Home'] },
  /** Focus camera on the current selection. */
  FOCUS_SELECTION: { label: 'F', keys: ['f', 'F'] },
  /** Toggle fly mode (V) — first-person WASD camera. */
  TOGGLE_FLY_MODE: { label: 'V', keys: ['v', 'V'] },
  /** Close the sidebar / clear selection. */
  CLEAR_SELECTION: { label: 'Esc', keys: ['Escape'] },
};
