// constants/gem.ts — Canonical vocabulary for the root gem's SIDES setting.
//
// Single source of truth for WHICH polyhedra the gem can be: the key set,
// each shape's name, and the default. Everything else derives from this:
//   - the GEM settings store (state/stores/settings/gem.ts) builds the
//     SIDES Select options + tip from GEM_SIDES / GEM_SIDES_NAMES,
//   - the gem component's geometry table (city/components/gem/shapes.ts)
//     is typed Record<GemSides, …>, so the compiler rejects a missing or
//     extra shape there.
//
// Lives in constants/ (not the gem component) because both state/ and
// city/ import from here already — stores never import city/components.
// The THREE geometry builders stay gem-local in components/gem/shapes.ts.

export const GEM_SIDES_NAMES = {
  '4': 'tetrahedron',
  '8': 'octahedron',
  '20': 'icosahedron',
} as const;

export type GemSides = keyof typeof GEM_SIDES_NAMES;

/** The selectable face counts, in display order (integer-like keys enumerate
 *  numerically ascending: '4', '8', '20'). */
export const GEM_SIDES = Object.keys(GEM_SIDES_NAMES) as GemSides[];

export const GEM_SIDES_DEFAULT: GemSides = '8';
