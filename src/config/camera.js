// config/camera.js — Perspective, OrbitControls, and camera animation timings.
// Perspective + controls are read at scene init (rebuild-required); animation
// timings are read fresh per call (hot-reloadable).

import { map } from 'nanostores';

export const CAMERA_PERSPECTIVE = map({
  FOV:  45,           // vertical field-of-view in degrees
  NEAR: 1,
  FAR:  20000
});

export const CAMERA_CONTROLS = map({
  DAMPING_FACTOR:        0.08,    // OrbitControls inertia (higher = snappier)
  MAX_POLAR_ANGLE_FRAC:  0.49,    // × Math.PI; how close to vertical orbit can go
  MIN_DISTANCE:          30,      // closest zoom (world units)
  MAX_DISTANCE_MULT:     4,       // furthest zoom = initial distance × this
  INITIAL_DISTANCE_MULT: 0.95     // boot framing tightness (1.0 = exact bbox fit)
});

// ─── Animation timings + framing ───────────────────────────────────────────
// All durations in milliseconds. Read fresh per gesture so changes apply
// immediately without restart.
export const CAMERA_ANIMATION = map({
  EASING_POWER:                   3,        // ease-out exponent (1 - (1-t)^P)
  PAN_EASING_POWER:               2,        // pivot-recenter pan easing (ease-out quad)
  RECENTER_DURATION_MS:           350,
  RESET_DURATION_MS:              500,
  BUILDING_FOCUS_DURATION_MS:     600,
  BUILDING_FOCUS_DISTANCE_MULT:   1.6,      // padding multiplier on the fitted distance
  BUILDING_FOCUS_DISTANCE_OFFSET: 4,
  BUILDING_FOCUS_SIGHTLINE_STEP_DEG: 20,    // elevation step when retrying for clear sightline
  BUILDING_FOCUS_SIGHTLINE_ATTEMPTS: 5,     // max retries to find an unobstructed angle
  SIGHT_CHECK_FAR_OFFSET:         0.5,      // raycaster.far reduction for sightline test
  STREET_FOCUS_DURATION_MS:       600,
  STREET_FOCUS_LENGTH_FRAC:       0.65,     // visible street length = full × this
  STREET_FOCUS_WIDTH_MULT:        4,        // visible street width = street width × this
  STREET_FOCUS_ALTITUDE_BLDG_MULT: 1.4,     // altitude floor = max bldg height × this
  STREET_FOCUS_ALTITUDE_FLOOR:    50,       // …plus this constant
  STREET_FOCUS_ELEVATION_DEG:     87        // near-vertical (just under polar limit)
});
