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
//
// FOG_* parameters drive a height-based "ground haze" applied by the
// building shader (NOT THREE.Fog, which is distance-from-camera and
// erases the city when zoomed out). The haze is densest at world Y=0
// and falls off exponentially with height, so building bases sit in
// the mist while tops poke into clean air. Camera distance doesn't
// affect it.
//
//   FOG_COLOR        — tint the mist mixes toward.
//   FOG_INTENSITY    — peak fog amount at ground level (0..1).
//   FOG_HEIGHT_FRAC  — half-fall-off height as a fraction of the
//                      tallest possible building (BUILDING_DIMENSIONS
//                      MAX_FLOORS × FLOOR_HEIGHT). Auto-scales with
//                      the building size config so the haze always
//                      sits in the same relative band of the skyline.
//                      0.25 → mist fades by mid-height of short
//                      buildings; 0.5 → mist halfway up the tallest.
export interface SceneColorsConfig {
  GROUND: string;
  FOG_ENABLED: boolean;
  FOG_COLOR: string;
  FOG_INTENSITY: number;
  FOG_HEIGHT_FRAC: number;
}

// FOG_ENABLED off → uFogIntensity uniform is forced to 0 (the shader's
// mix() then returns the original color unchanged). Other knobs stay
// in config so flipping ENABLED back restores the haze.
export const SCENE_COLORS = map<SceneColorsConfig>({
  GROUND: '#0a0e1c',
  FOG_ENABLED: true,
  FOG_COLOR: '#0f0821',
  FOG_INTENSITY: 0.8,
  FOG_HEIGHT_FRAC: 0.50,
});

// ─── Camera lens ───────────────────────────────────────────────────────────
export interface CameraPerspectiveConfig {
  FOV: number;
  NEAR: number;
  FAR: number;
}

export const CAMERA_PERSPECTIVE = map<CameraPerspectiveConfig>({
  FOV: 45, // vertical field-of-view in degrees
  NEAR: 1,
  FAR: 20000,
});

// ─── Camera orbit + zoom controls ──────────────────────────────────────────
export interface CameraControlsConfig {
  DAMPING_FACTOR: number;
  MAX_POLAR_ANGLE_FRAC: number;
  MIN_DISTANCE: number;
  MAX_DISTANCE_MULT: number;
  INITIAL_DISTANCE_MULT: number;
}

export const CAMERA_CONTROLS = map<CameraControlsConfig>({
  DAMPING_FACTOR: 0.08, // OrbitControls inertia (higher = snappier)
  MAX_POLAR_ANGLE_FRAC: 0.49, // × Math.PI; how close to vertical orbit can go
  MIN_DISTANCE: 30, // closest zoom (world units)
  MAX_DISTANCE_MULT: 10, // furthest zoom = worldRadius × this (where
                         // worldRadius = bbox diagonal, including building
                         // height). Floored at MIN_MAX_DISTANCE in cameraRig
                         // so tiny cities still get a comfortable zoom-out
                         // range. Previously multiplied worldDist (a
                         // FOV-derived value) — switching to worldRadius
                         // removes the FOV-dependency surprise.
  INITIAL_DISTANCE_MULT: 0.75, // boot framing tightness (1.0 = exact bbox fit;
                               // < 1 lands the camera closer to the gem).
});

// ─── Camera focus framing ──────────────────────────────────────────────────
// Geometric framing parameters for building / street focus actions — how
// far away the camera lands, how much of the street fits on screen, etc.
// Read fresh per gesture so changes apply immediately without restart.
//
// Timing for these actions (durations, easing) lives in ANIMATION_TIMING
// (see config/animation.ts) and is shared across every camera tween via
// per-action ratios defined at the call sites in scene/cameraRig.ts.
//
// (Sightline-search internals — step deg, max attempts, ray epsilon —
// are inlined as private consts in main.js; they're algorithm tuning,
// not designer dials.)
export interface CameraAnimationConfig {
  BUILDING_FOCUS_DISTANCE_MULT: number;
  BUILDING_FOCUS_DISTANCE_OFFSET: number;
  STREET_FOCUS_LENGTH_FRAC: number;
  STREET_FOCUS_WIDTH_MULT: number;
  STREET_FOCUS_ALTITUDE_BLDG_MULT: number;
  STREET_FOCUS_ALTITUDE_FLOOR: number;
  STREET_FOCUS_ELEVATION_DEG: number;
}

export const CAMERA_ANIMATION = map<CameraAnimationConfig>({
  BUILDING_FOCUS_DISTANCE_MULT: 1.6, // padding multiplier on the fitted distance
  BUILDING_FOCUS_DISTANCE_OFFSET: 4,
  STREET_FOCUS_LENGTH_FRAC: 0.65, // visible street length = full × this
  STREET_FOCUS_WIDTH_MULT: 4, // visible street width = street width × this
  STREET_FOCUS_ALTITUDE_BLDG_MULT: 1.4, // altitude floor = max bldg height × this
  STREET_FOCUS_ALTITUDE_FLOOR: 50, // …plus this constant
  STREET_FOCUS_ELEVATION_DEG: 87, // near-vertical (just under polar limit)
});

// ─── Pointer input timing ──────────────────────────────────────────────────
// Click vs drag detection + hover stickiness. Read per-event so the Settings
// UI's tweaks apply immediately.
export interface InputTimingConfig {
  CLICK_MOVE_THRESHOLD_PX: number;
  CLICK_TIME_THRESHOLD_MS: number;
  HOVER_COMMIT_MS: number;
}

export const INPUT_TIMING = map<InputTimingConfig>({
  CLICK_MOVE_THRESHOLD_PX: 5, // pointer must move < this px to count as a click
  CLICK_TIME_THRESHOLD_MS: 400, // …and release within this window
  HOVER_COMMIT_MS: 35, // ms cursor must stay on a target before
  // the heavy fade cascade commits
});

// ─── Tooltip placement ─────────────────────────────────────────────────────
export interface TooltipConfig {
  OFFSET_PX: number;
  VIEWPORT_MARGIN_PX: number;
}

export const TOOLTIP = map<TooltipConfig>({
  OFFSET_PX: 14, // distance from cursor
  VIEWPORT_MARGIN_PX: 4, // safety margin from viewport edges
});
