// city/render/framingDir.ts — the default camera's offset direction (camera =
// target + dir·distance), derived from a user-tunable elevation + azimuth. The
// target is always the root gem; only this direction changes. Pure math so it's
// unit-testable without the rig/canvas.

import * as THREE from 'three';
import { StreetAxis } from '../types/street';

const DEG2RAD = Math.PI / 180;

/**
 * Unit camera-offset direction for the start framing. `elevationDeg` lifts the
 * camera above the horizon (90° = straight overhead); `azimuthDeg` swings it
 * around the gem, measured off the root street's long axis (0° = looking
 * straight down the street from behind the gem). `axis` is the root street's
 * orientation, or null when there's no gem (a high-oblique fallback).
 */
export function computeFramingDir(
  elevationDeg: number,
  azimuthDeg: number,
  axis: StreetAxis | null
): THREE.Vector3 {
  const e = elevationDeg * DEG2RAD;
  const a = azimuthDeg * DEG2RAD;
  const cosE = Math.cos(e);
  const sinE = Math.sin(e);
  // Behind the gem along the street's long axis; azimuth mixes in the
  // perpendicular (lateral) horizontal axis; elevation lifts it toward +Y.
  if (axis === StreetAxis.X) {
    return new THREE.Vector3(-cosE * Math.cos(a), sinE, cosE * Math.sin(a)).normalize();
  }
  if (axis === StreetAxis.Y) {
    return new THREE.Vector3(cosE * Math.sin(a), sinE, -cosE * Math.cos(a)).normalize();
  }
  // No root street (no gem): honor the angles against a default X-axis frame.
  return new THREE.Vector3(-cosE * Math.cos(a), sinE, cosE * Math.sin(a)).normalize();
}
