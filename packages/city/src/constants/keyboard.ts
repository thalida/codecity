// city/constants/keyboard.ts — the keys the city itself answers to, and where
// they must not fire. Shipped with the renderer so a consumer gets working
// shortcuts without wiring any, and declared rather than hidden so the same
// consumer can document them (or turn them off — see createCity's `keyboard`).

/** Tags whose focus suppresses every shortcut below, so typing an "r" into a
 *  field does not reset the camera. Matches the uppercase Element.tagName. */
export const TEXT_INPUT_TAGS: readonly string[] = ['INPUT', 'TEXTAREA'];

/** One binding: a primary key plus aliases (case, and 'Home' for reset). */
export interface KeyBinding {
  /** Display label shown in a help table (one entry per visual key). */
  label: string;
  /** All KeyboardEvent.key values that fire this action. */
  keys: readonly string[];
}

/** What the canvas answers to. A consumer's own shortcuts are its own. */
export const CITY_KEY_BINDINGS = {
  /** Reset the framing to the camera's default pose, as clicking the gem does.
   *  Does NOT rebuild the manifest: reload the page for that. */
  RESET_VIEW: { label: 'R', keys: ['r', 'R', 'Home'] },
  /** Point the camera at the current selection. */
  FOCUS_SELECTION: { label: 'F', keys: ['f', 'F'] },
  /** Clear the selection. */
  CLEAR_SELECTION: { label: 'Esc', keys: ['Escape'] },
} satisfies Record<string, KeyBinding>;
