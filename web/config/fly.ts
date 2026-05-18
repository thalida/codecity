// config/fly.ts — Fly-mode camera control tunables. Read fresh per frame /
// per gesture so Controls-pane edits take effect immediately. See
// docs/superpowers/specs/2026-05-17-fly-mode-navigation-design.md for
// the full design.

import { map } from 'nanostores';

export interface FlyControlsConfig {
  // Base speed = clamp(worldBboxRadius × BASE_SPEED_BBOX_FRAC,
  //                    BASE_SPEED_MIN, BASE_SPEED_MAX)
  BASE_SPEED_BBOX_FRAC: number;
  BASE_SPEED_MIN: number;
  BASE_SPEED_MAX: number;

  BOOST_MULT: number;          // Shift-hold multiplier
  ACCEL_RAMP_MS: number;       // Velocity ease time (in + out)
  MOUSE_SENSITIVITY: number;   // Radians per pixel of pointer-lock movement
  PITCH_CLAMP_DEG: number;     // Prevent gimbal lock
  ALTITUDE_FLOOR: number;      // Min y position (prevents going under ground)

  // Fly-default pose
  FLY_DEFAULT_GEM_OFFSET_MULT: number;  // Distance behind gem = gemRadius × this
  FLY_DEFAULT_ALTITUDE_FRAC: number;    // Height = maxBuildingHeight × this
}

export const FLY_CONTROLS = map<FlyControlsConfig>({
  BASE_SPEED_BBOX_FRAC: 0.15,
  BASE_SPEED_MIN: 5,
  BASE_SPEED_MAX: 200,

  BOOST_MULT: 4,
  ACCEL_RAMP_MS: 100,
  MOUSE_SENSITIVITY: 0.002,
  PITCH_CLAMP_DEG: 85,
  ALTITUDE_FLOOR: 0.5,

  FLY_DEFAULT_GEM_OFFSET_MULT: 2,
  // 5% of tallest building, capped at 8 units (in resetToDefault) so
  // a skyscraper-tall repo doesn't put the camera above the skyline.
  // Tuned for street-level "walking down the street" feel.
  FLY_DEFAULT_ALTITUDE_FRAC: 0.05,
});
