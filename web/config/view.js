// config/view.js — The viewer's experience: sky color, camera lens, orbit
// + zoom controls, camera-animation timings, pointer feel, tooltip placement.
// Everything in here describes how the user *looks at* the city, as opposed
// to how the city itself is built.
//
// Camera perspective + controls are read at scene init (rebuild-required);
// camera animation timings + input timings + sky color are read fresh per
// event/frame (hot-reloadable).

import { map } from 'nanostores';

// ─── Sky / scene background ────────────────────────────────────────────────
// The void color drawn behind everything. Hot-reloadable.
export const SCENE_COLORS = map({
  GROUND: '#0a0b10'
});

// ─── Camera lens ───────────────────────────────────────────────────────────
export const CAMERA_PERSPECTIVE = map({
  FOV:  45,           // vertical field-of-view in degrees
  NEAR: 1,
  FAR:  20000
});

// ─── Camera orbit + zoom controls ──────────────────────────────────────────
export const CAMERA_CONTROLS = map({
  DAMPING_FACTOR:        0.08,    // OrbitControls inertia (higher = snappier)
  MAX_POLAR_ANGLE_FRAC:  0.49,    // × Math.PI; how close to vertical orbit can go
  MIN_DISTANCE:          30,      // closest zoom (world units)
  MAX_DISTANCE_MULT:     4,       // furthest zoom = initial distance × this
  INITIAL_DISTANCE_MULT: 0.95     // boot framing tightness (1.0 = exact bbox fit)
});

// ─── Camera animation timings + framing ────────────────────────────────────
// All durations in milliseconds. Read fresh per gesture so changes apply
// immediately without restart. (Sightline-search internals — step deg,
// max attempts, ray epsilon — are inlined as private consts in main.js;
// they're algorithm tuning, not designer dials.)
export const CAMERA_ANIMATION = map({
  EASING_POWER:                   3,        // ease-out exponent (1 - (1-t)^P) for all camera animations
  RECENTER_DURATION_MS:           350,
  RESET_DURATION_MS:              500,
  BUILDING_FOCUS_DURATION_MS:     600,
  BUILDING_FOCUS_DISTANCE_MULT:   1.6,      // padding multiplier on the fitted distance
  BUILDING_FOCUS_DISTANCE_OFFSET: 4,
  STREET_FOCUS_DURATION_MS:       600,
  STREET_FOCUS_LENGTH_FRAC:       0.65,     // visible street length = full × this
  STREET_FOCUS_WIDTH_MULT:        4,        // visible street width = street width × this
  STREET_FOCUS_ALTITUDE_BLDG_MULT: 1.4,     // altitude floor = max bldg height × this
  STREET_FOCUS_ALTITUDE_FLOOR:    50,       // …plus this constant
  STREET_FOCUS_ELEVATION_DEG:     87        // near-vertical (just under polar limit)
});

// ─── Pointer input timing ──────────────────────────────────────────────────
// Click vs drag detection + hover stickiness. Read per-event so the Settings
// UI's tweaks apply immediately.
export const INPUT_TIMING = map({
  CLICK_MOVE_THRESHOLD_PX: 5,    // pointer must move < this px to count as a click
  CLICK_TIME_THRESHOLD_MS: 400,  // …and release within this window
  HOVER_COMMIT_MS:         35    // ms cursor must stay on a target before
                                 // the heavy fade cascade commits
});

// ─── Tooltip placement ─────────────────────────────────────────────────────
export const TOOLTIP = map({
  OFFSET_PX:          14,      // distance from cursor
  VIEWPORT_MARGIN_PX: 4        // safety margin from viewport edges
});
