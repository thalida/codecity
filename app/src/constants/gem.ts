// constants/gem.ts — which polyhedra the root gem can be. The settings store
// and the geometry table both key off this, so the compiler catches a shape
// missing from either. In constants/ because stores never import city/.

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
