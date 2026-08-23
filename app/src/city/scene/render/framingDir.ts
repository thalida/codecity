// city/render/framingDir.ts — the default camera's offset direction (camera =
// target + dir·distance), derived from a user-tunable elevation + azimuth. The
// target is always the root gem; only this direction changes. Pure math so it's
// unit-testable without the rig/canvas.

import * as THREE from 'three';
import { StreetAxis } from '@/city/scene/types';

const DEG2RAD = Math.PI / 180;

/** Unit camera offset for the start framing: elevation lifts off the horizon,
 *  azimuth swings around the gem from the root street's axis. No axis: oblique. */
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
