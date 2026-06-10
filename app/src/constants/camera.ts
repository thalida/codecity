// constants/camera.ts — Fixed camera lens + orbit-control tuning. Not
// user-tunable (no Settings control ever exposed these), so plain constants
// rather than a persisted settings store. Read by city/runtime/cameraRig.ts;
// CAMERA_FAR is also read by the sky sphere (city/components/sky/index.ts).

export const CAMERA_FOV = 45; // vertical field-of-view in degrees
export const CAMERA_NEAR = 1;
export const CAMERA_FAR = 20000;

export const CAMERA_DAMPING_FACTOR = 0.08; // OrbitControls inertia (higher = snappier)
export const CAMERA_MAX_POLAR_ANGLE_FRAC = 0.49; // × Math.PI; how close to vertical orbit can go
export const CAMERA_MIN_DISTANCE = 30; // closest zoom (world units)
export const CAMERA_MAX_DISTANCE_MULT = 10; // furthest zoom = worldRadius × this
export const CAMERA_INITIAL_DISTANCE_MULT = 0.75; // boot framing tightness (1.0 = exact bbox fit)

// Camera-tween timing (was ANIMATION_TIMING; never exposed as a Settings
// control). BASE_DURATION_MS is the "Reset" duration and the base every other
// camera tween scales off via a per-action ratio (RECENTER, BUILDING_FOCUS, …).
// EASING_POWER is the exponent for the easeOutPower curve 1 - (1 - t)^P used by
// all camera tweens (1 = linear, 3 = ease-out cubic, higher = snappier).
export const CAMERA_BASE_DURATION_MS = 500;
export const CAMERA_EASING_POWER = 3;
