// state/settings/system/cameraRig.ts — Camera lens, orbit/zoom controls, and
// per-action focus framing. Read by scene/system/cameraRig.ts at scene
// init (perspective + controls — rebuild-required) and per-gesture
// (animation — applied on Save via applyTheme() — see configCommitReactions.ts).
//
// Animation timing for focus actions (durations, easing) lives in
// system/animator.ts and is shared across every camera tween via
// per-action ratios defined at the call sites in scene/cameraRig.ts.
//
// (Sightline-search internals — step deg, max attempts, ray epsilon —
// are inlined as private consts in main.ts; they're algorithm tuning,
// not designer dials.)

import { persistedSignal } from '@/state/persist';

// ─── Camera lens ───────────────────────────────────────────────────────────
export interface CameraPerspectiveConfig {
  FOV: number;
  NEAR: number;
  FAR: number;
}

export const CAMERA_PERSPECTIVE = persistedSignal<CameraPerspectiveConfig>('CAMERA_PERSPECTIVE', {
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

export const CAMERA_CONTROLS = persistedSignal<CameraControlsConfig>('CAMERA_CONTROLS', {
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

