// city/components/gem/palette.ts — the one place that knows the gem's flat
// FACE_1..FACE_8 keys become an ordered list of triples, so the geometry bake,
// the Save rewrite and the glow lerp cannot drift. The triples are memoized per
// city over its own GEM settings, so the per-frame glow allocates nothing.
import * as THREE from 'three';
import type { CitySettingsStore } from '../../settings/store';

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

/** One city's face triples, reparsed only when its GEM palette changes. The
 *  glow lerp reads this every frame: a fresh parse per frame would allocate
 *  eight Colors and eight arrays for a value that changes on a Save.
 *
 *  Keyed on the config object itself, which the settings store replaces
 *  wholesale on every update — so identity IS "has the palette changed". */
export function createGemPalette(settings: CitySettingsStore): () => Rgb[] {
  let key: object | null = null;
  let cached: Rgb[] = [];
  return () => {
    if (settings.GEM !== key) {
      key = settings.GEM;
      cached = paletteColors(settings.GEM);
    }
    return cached;
  };
}

/** Palette into a vertex-colour buffer, 9 floats per triangle: the 3 vertices
 *  of a face share its colour. Shared by the initial bake and the Save rewrite. */
export function writeFaceColors(arr: Float32Array, faceColors: Rgb[]): void {
  const faceCount = arr.length / 9; // 3 vertices × 3 channels per face
  for (let f = 0; f < faceCount; f++) {
    const fc = faceColors[f % faceColors.length];
    for (let v = 0; v < 3; v++) {
      const idx = (f * 3 + v) * 3;
      arr[idx] = fc[0];
      arr[idx + 1] = fc[1];
      arr[idx + 2] = fc[2];
    }
  }
}
