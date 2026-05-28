// config/fireflies.ts — committer-fireflies tunables.
//
// v2 exposes the size + animation knobs. BOB is the y-axis sinusoid
// the shader applies to displace each orb; PULSE is a brightness
// modulation (additive output color × (1 + pulseAmp * sin(...))).
// v4 adds emission (HDR bloom), flicker (high-frequency brightness noise),
// and per-author commit-count scaling (always on; tune spread via SCALE_MIN/MAX).
// v5 adds orbit-ring controls (ORBIT_RING_ENABLED, ORBIT_RING_COLOR,
// ORBIT_RING_OPACITY) and decouples orbit radius from per-author scale.
// v6 adds hover/selected highlight colors for orbit rings.

import { map } from 'nanostores';

export interface FirefliesConfig {
  /** Master toggle — when false no fireflies are placed or rendered. */
  FIREFLIES_ENABLED: boolean;
  /** Orbital speed around the tree's vertical axis, radians/sec. 0 = no orbit. */
  ORBIT_SPEED: number;
  /** Vertical bob amplitude in world units. */
  BOB_AMPLITUDE: number;
  /** Vertical bob speed in radians/sec. */
  BOB_SPEED: number;
  /** Brightness pulse amplitude. Output color is multiplied by (1 + amp * sin(...)). */
  PULSE_AMPLITUDE: number;
  /** Brightness pulse speed in radians/sec. */
  PULSE_SPEED: number;
  /** Base brightness multiplier. >1 pushes output into HDR for the bloom pass to catch. */
  EMISSION_STRENGTH: number;
  /** Pseudo-random high-frequency brightness noise on top of the pulse. 0 = smooth pulse, 1 = jittery. */
  FLICKER_AMOUNT: number;
  /** Scale multiplier for the author with the fewest commits. */
  SCALE_MIN: number;
  /** Scale multiplier for the author with the most commits. */
  SCALE_MAX: number;
  /** Show / hide the subtle orbit ring around each tree. */
  ORBIT_RING_ENABLED: boolean;
  /** Orbit ring color, hex string (e.g. '#ffffff'). */
  ORBIT_RING_COLOR: string;
  /** Orbit ring opacity, 0..1. */
  ORBIT_RING_OPACITY: number;
  /** Tube radius of the orbit ring in world units (constant across rings). */
  ORBIT_RING_THICKNESS: number;
  /** Orbit ring color when the corresponding tree is hovered, hex string. */
  ORBIT_RING_HOVER_COLOR: string;
  /** Orbit ring color when the corresponding tree is selected, hex string. */
  ORBIT_RING_SELECTED_COLOR: string;
}

export const FIREFLIES = map<FirefliesConfig>({
  FIREFLIES_ENABLED: true,
  ORBIT_SPEED: 0.3,
  BOB_AMPLITUDE: 0.5,
  BOB_SPEED: 1.1,
  PULSE_AMPLITUDE: 0.5,
  PULSE_SPEED: 1.5,
  EMISSION_STRENGTH: 1.5,
  FLICKER_AMOUNT: 0.75,
  SCALE_MIN: 0.5,
  SCALE_MAX: 2.5,
  ORBIT_RING_ENABLED: true,
  ORBIT_RING_COLOR: '#9380ff',
  ORBIT_RING_OPACITY: 0.05,
  ORBIT_RING_THICKNESS: 0.15,
  ORBIT_RING_HOVER_COLOR: '#ffffff',
  ORBIT_RING_SELECTED_COLOR: '#ffd700',
});
