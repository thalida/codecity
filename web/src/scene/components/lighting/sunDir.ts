// scene/lighting/sunDir.ts — Shared utility that converts LIGHTING's
// spherical (azimuth, elevation) sun position into a unit world-space
// direction TOWARD the sun.
//
// Convention: azimuth=0 points along +Z (south, in world coords),
// increasing clockwise (so azimuth=90 points along +X / east);
// elevation=0 is on the horizon, elevation=90 is directly overhead.
//
// At the default (az=51°, el=58°) this reproduces the prior hard-coded
// `normalize(vec3(0.5, 1.0, 0.4))` to within rounding.
//
// Two entry points:
//   writeSunDir(out) — writes into a caller-provided Vector3 (no
//     allocation; preferred in tick() hot loops).
//   sunDirFromLighting() — returns a fresh Vector3 (convenient for
//     one-shot bakes like tree vertex shading).

import * as THREE from 'three';
import { LIGHTING } from '@/config/components/lighting.js';

export function writeSunDir(out: THREE.Vector3): void {
  const lighting = LIGHTING.get();
  const az = (lighting.SUN_AZIMUTH_DEG * Math.PI) / 180;
  const el = (lighting.SUN_ELEVATION_DEG * Math.PI) / 180;
  const cosEl = Math.cos(el);
  out.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl).normalize();
}

export function sunDirFromLighting(): THREE.Vector3 {
  const out = new THREE.Vector3();
  writeSunDir(out);
  return out;
}
