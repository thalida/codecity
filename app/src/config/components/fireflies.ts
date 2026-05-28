// config/fireflies.ts — committer-fireflies tunables.
//
// v2 exposes the size + animation knobs. ORB_RADIUS is in world units;
// the orb's actual diameter is 2×ORB_RADIUS. BOB is the y-axis sinusoid
// the shader applies to displace each orb; PULSE is a brightness
// modulation (additive output color × (1 + pulseAmp * sin(...))).
// v4 adds emission (HDR bloom), flicker (high-frequency brightness noise),
// and per-author commit-count scaling.

import { map } from 'nanostores';

export interface FirefliesConfig {
  /** Master toggle — when false no fireflies are placed or rendered. */
  FIREFLIES_ENABLED: boolean;
  /** Sphere radius in world units. v1 default was 0.12 (invisible at city scale). */
  FIREFLY_RADIUS: number;
  /** Number of orbs spawned per commit-tree. Total orbs = ORBS_PER_TREE × commits. */
  ORBS_PER_TREE: number;
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
  /** When true, each author's orbs scale by [SCALE_MIN..SCALE_MAX] mapped from their commit count. */
  SCALE_BY_COMMITS: boolean;
  /** Scale multiplier for the author with the fewest commits. */
  SCALE_MIN: number;
  /** Scale multiplier for the author with the most commits. */
  SCALE_MAX: number;
}

export const FIREFLIES = map<FirefliesConfig>({
  FIREFLIES_ENABLED: true,
  FIREFLY_RADIUS: 1.0,
  ORBS_PER_TREE: 1,
  ORBIT_SPEED: 0.3,
  BOB_AMPLITUDE: 0.5,
  BOB_SPEED: 1.1,
  PULSE_AMPLITUDE: 0.6,
  PULSE_SPEED: 1.5,
  EMISSION_STRENGTH: 2.5,
  FLICKER_AMOUNT: 0.3,
  SCALE_BY_COMMITS: true,
  SCALE_MIN: 0.5,
  SCALE_MAX: 2.5,
});
