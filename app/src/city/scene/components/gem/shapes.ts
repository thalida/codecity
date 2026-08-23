// city/scene/components/gem/shapes.ts — SIDES → geometry for the root gem's
// body. Keyed by the GEM_SIDES vocabulary, as a Record, so the table is
// exhaustive at compile time: a shape added there errors here until it is
// built. mesh.ts goes through buildGemGeometry, never a switch.

import * as THREE from 'three';
import { GEM_SIDES_DEFAULT, type GemSides } from '@/city/scene/constants/gem';

/** Face count → geometry builder. detail 0 keeps the raw polyhedron
 *  (un-subdivided), so the face count matches the key. */
export const GEM_SHAPES: Record<GemSides, (radius: number) => THREE.BufferGeometry> = {
  '4': (radius) => new THREE.TetrahedronGeometry(radius, 0),
  '8': (radius) => new THREE.OctahedronGeometry(radius, 0),
  '20': (radius) => new THREE.IcosahedronGeometry(radius, 0),
};

/** Build the gem body geometry for a SIDES setting value. A stale persisted
 *  value outside GEM_SIDES falls back to the default shape (octahedron). */
export function buildGemGeometry(sides: string, radius: number): THREE.BufferGeometry {
  const build = GEM_SHAPES[sides as GemSides] ?? GEM_SHAPES[GEM_SIDES_DEFAULT];
  return build(radius);
}
