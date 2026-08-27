// city/components/gem/shapes.ts — SIDES → THREE geometry builders for the
// root gem's body. The key set is the canonical GEM_SIDES vocabulary from
// constants/gem.ts; the Record type makes this table compile-time exhaustive
// against it (a shape added or removed there errors here, and vice versa).
// mesh.ts builds the body through buildGemGeometry() — no hand-written
// switch over the shape set anywhere.

import * as THREE from 'three';
import { GEM_SIDES_DEFAULT, type GemSides } from '@codecity/city';

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
