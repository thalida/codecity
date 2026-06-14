// city/utils/shaders/sunDir.ts — Converts a spherical (azimuth, elevation) sun
// position into a unit world-space direction TOWARD the sun.
//
// Convention: azimuth=0 points along +Z (south, in world coords), increasing
// clockwise (so azimuth=90 points along +X / east); elevation=0 is on the
// horizon, elevation=90 is directly overhead.
//
// Pure math, decoupled from any store — callers pass the angles (production
// passes the LIGHTING_* constants from constants/lighting; tests pass explicit
// values). At (az=51°, el=58°) this reproduces the prior hard-coded
// normalize(vec3(0.5, 1.0, 0.4)) to within rounding.
//
// Two entry points:
//   writeSunDir(out, azDeg, elDeg) — writes into a caller-provided Vector3 (no
//     allocation; preferred in tick() hot loops).
//   sunDir(azDeg, elDeg) — returns a fresh Vector3 (convenient for one-shot
//     bakes like tree vertex shading).

import * as THREE from 'three';

export function writeSunDir(out: THREE.Vector3, azimuthDeg: number, elevationDeg: number): void {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  out.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl).normalize();
}

export function sunDir(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const out = new THREE.Vector3();
  writeSunDir(out, azimuthDeg, elevationDeg);
  return out;
}
