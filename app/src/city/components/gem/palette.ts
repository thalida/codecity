// city/components/gem/palette.ts — single source of the gem's face palette.
//
// The GEM settings store keeps the eight face colors as flat FACE_1..FACE_8
// keys (the settings convention is bare scalar keys, not arrays). Everything
// that consumes the palette wants an ordered list of [r, g, b] triples:
//
//   - mesh.ts bakes them into the body geometry's per-face color attribute,
//   - the theme effect in index.ts rewrites that attribute in place on Save,
//   - the glow cycle in index.ts tick() lerps between adjacent entries.
//
// This helper is the ONE place that knows the flatten order and the
// hex→triple parse, so the three consumers can never drift apart.
// Gem-specific knowledge — deliberately NOT a global color util.
//
// Two exports: the pure paletteColors(palette) parse (structural param, so
// mesh.ts and tests can pass any palette source), and gemFaceColors — a
// memoized computed over the live GEM store for per-frame consumers (the
// glow cycle in tick() reads it every frame; the computed caches the parsed
// array until GEM changes, so steady-state frames allocate nothing).

import * as THREE from 'three';
import { computed } from '@preact/signals';

import { GEM } from '@/state/stores/settings/gem';

/** Structural slice of GEM settings — only the face-color keys, so tests
 *  (and any future palette source) can pass a minimal object. */
export interface GemFacePalette {
  FACE_1: string;
  FACE_2: string;
  FACE_3: string;
  FACE_4: string;
  FACE_5: string;
  FACE_6: string;
  FACE_7: string;
  FACE_8: string;
}

export type Rgb = readonly [number, number, number];

/** FACE_1..FACE_8 flattened in order and parsed to [r, g, b] triples
 *  (each 0..1, via THREE.Color's standard hex parse). */
export function paletteColors(palette: GemFacePalette): Rgb[] {
  const hexes = [
    palette.FACE_1,
    palette.FACE_2,
    palette.FACE_3,
    palette.FACE_4,
    palette.FACE_5,
    palette.FACE_6,
    palette.FACE_7,
    palette.FACE_8,
  ];
  return hexes.map((hex) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b] as const;
  });
}

/** The live GEM store's face palette, parsed once per GEM change (Save) and
 *  cached — same array identity across reads until the store updates. */
export const gemFaceColors = computed(() => paletteColors(GEM.value));
