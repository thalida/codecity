// city/utils/rainbowChase.ts — the single rainbow-chase hue kernel.
//
// Several selection-outline renderers (tree silhouette, building silhouette,
// firefly orbit ring, gem→selection path line) animate a "rainbow chase": one
// hue per buffer element, the whole band rotating around the shape over time.
// The buffer WRITES differ per site (segment colors, interleaved
// instanceColorStart, TubeGeometry color attr, LineSegmentsGeometry), but the
// PER-ELEMENT color math is identical:
//
//   t   = timeMs * RAINBOW.SPEED          // hue cycles; SPEED is cycles/ms
//   hue = (((t + fraction) % 1) + 1) % 1  // wrap into [0,1), even if negative
//   rgb = Color.setHSL(hue, RAINBOW.SATURATION, RAINBOW.LIGHTNESS)
//
// `fraction` is the element's position offset within the cycle (e.g. i/N for
// segment i of N). This kernel owns that math; each site keeps its own loop
// over its own buffer layout and calls rainbowRgbAt() per element.
import * as THREE from 'three';

import { RAINBOW } from '@/state/stores/settings/effects';

// Scratch reused across calls so steady-state frames allocate nothing.
const _scratchColor = new THREE.Color();
const _scratchOut: [number, number, number] = [0, 0, 0];

/**
 * Linear-RGB for one rainbow-chase element at the given time + cycle offset.
 *
 * Reads SPEED / SATURATION / LIGHTNESS from RAINBOW.value internally
 * (t = timeMs·SPEED, hue wrapped into [0,1), THREE.Color.setHSL → linear-RGB).
 *
 * @param timeMs   raw clock (e.g. performance.now()); multiplied by SPEED here.
 * @param fraction element's hue offset within the cycle (e.g. i / N).
 * @param out      optional [r,g,b] to write into. Omit to reuse a shared
 *                 scratch tuple (valid until the next call) for zero alloc.
 */
export function rainbowRgbAt(
  timeMs: number,
  fraction: number,
  out: [number, number, number] = _scratchOut
): [number, number, number] {
  const rb = RAINBOW.value;
  const t = timeMs * rb.SPEED;
  const hue = (((t + fraction) % 1) + 1) % 1;
  _scratchColor.setHSL(hue, rb.SATURATION, rb.LIGHTNESS);
  out[0] = _scratchColor.r;
  out[1] = _scratchColor.g;
  out[2] = _scratchColor.b;
  return out;
}
