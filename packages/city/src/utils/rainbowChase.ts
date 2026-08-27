// city/utils/rainbowChase.ts — the one hue kernel behind every rainbow chase
// (tree and building silhouettes, orbit rings, the path line). Each site writes
// its own buffer layout; only the per-element colour math is shared:
//   hue = wrap(timeMs * SPEED + fraction) -> setHSL(hue, SATURATION, LIGHTNESS)
import * as THREE from 'three';

import type { RainbowConfig } from '@/city/settings/fields/effects';

// Scratch reused across calls so steady-state frames allocate nothing.
const _scratchColor = new THREE.Color();
const _scratchOut: [number, number, number] = [0, 0, 0];

/** Linear-RGB for one element: `timeMs` is a raw clock, `fraction` its offset
 *  in the cycle. Omit `out` to reuse a shared tuple, valid until the next call. */
export function rainbowRgbAt(
  timeMs: number,
  fraction: number,
  rb: RainbowConfig,
  out: [number, number, number] = _scratchOut
): [number, number, number] {
  const t = timeMs * rb.SPEED;
  const hue = (((t + fraction) % 1) + 1) % 1;
  _scratchColor.setHSL(hue, rb.SATURATION, rb.LIGHTNESS);
  out[0] = _scratchColor.r;
  out[1] = _scratchColor.g;
  out[2] = _scratchColor.b;
  return out;
}
