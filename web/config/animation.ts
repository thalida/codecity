// config/animation.ts — Shared timing primitives for camera + building
// transitions. Replaces the per-action absolute durations that previously
// lived in CAMERA_ANIMATION and the hard-coded ENTER_MS / STAY_MS in
// animator.ts.
//
//   BASE_DURATION_MS    — the "Reset" duration, also the base for every
//                         other camera tween via a fixed per-action ratio
//                         defined at the consumer site (RECENTER = 0.7×,
//                         BUILDING_FOCUS = 1.2×, etc).
//   EASING_POWER        — exponent for the easeOutPower curve used by all
//                         camera tweens: 1 - (1 - t)^P. 1 = linear,
//                         3 = ease-out cubic (default), higher = snappier.
//   BUILDING_TRANSITION_MS — enter / stay duration for buildings.
//                         Default is 375, the midpoint of the old
//                         ENTER_MS=400 / STAY_MS=350 split — those two
//                         tweens are now driven by the same knob.
//
// All values are read fresh per gesture (.get() at action time) so Settings
// UI tweaks apply immediately without restart — there's no module-level
// cache of any of these.

import { map } from 'nanostores';

export interface AnimationTimingConfig {
  BASE_DURATION_MS: number;
  EASING_POWER: number;
  BUILDING_TRANSITION_MS: number;
}

export const ANIMATION_TIMING = map<AnimationTimingConfig>({
  BASE_DURATION_MS: 500,
  EASING_POWER: 3,
  BUILDING_TRANSITION_MS: 375,
});
