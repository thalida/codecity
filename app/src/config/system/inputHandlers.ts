// config/system/inputHandlers.ts — Pointer input timing. Click vs drag
// detection and hover stickiness. Consumed by
// scene/system/inputHandlers.ts. Read per-event so the Settings UI's
// tweaks apply immediately.

import { map } from 'nanostores';

export interface InputTimingConfig {
  CLICK_MOVE_THRESHOLD_PX: number;
  CLICK_TIME_THRESHOLD_MS: number;
  HOVER_COMMIT_MS: number;
}

export const INPUT_TIMING = map<InputTimingConfig>({
  CLICK_MOVE_THRESHOLD_PX: 5, // pointer must move < this px to count as a click
  CLICK_TIME_THRESHOLD_MS: 400, // …and release within this window
  HOVER_COMMIT_MS: 35, // ms cursor must stay on a target before the heavy
  // fade cascade commits
});
