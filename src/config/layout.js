// config/layout.js — Street network positioning. Changing any of these shifts
// every street + building, so the scene must be re-laid-out and re-built.
// NOT hot-reloadable (Settings UI surfaces these in the Advanced tab with a
// "rebuild" hint).

import { atom, map } from 'nanostores';

// Distances (world units) between things on the street network.
//   CHILD_GAP        — between sibling children (file or subdir) on a street
//   BLDG_STREET_GAP  — between a building wall and the adjacent sidewalk
//   PATH_WIDTH       — connector strip that bridges that gap (must be ≤ BLDG_STREET_GAP)
//   ROOT_END_PAD     — fallback pad at each end of the root street (which
//                      has no parent intersection to size against)
//   PARENT_JOIN_PAD  — extra clear space where a child street meets its parent
export const LAYOUT_GAPS = map({
  CHILD_GAP:       5,
  BLDG_STREET_GAP: 4,
  PATH_WIDTH:      3,
  ROOT_END_PAD:    8,
  PARENT_JOIN_PAD: 3
});

// Step-function mapping descendant count → street width. The first matching
// tier from the top wins. Wider streets read as more important directories
// from the air. Stored as an atom because it's an array, not a key/value map.
export const STREET_TIERS = atom([
  { min_descendants: 0,  width: 10 },
  { min_descendants: 4,  width: 16 },
  { min_descendants: 9,  width: 24 },
  { min_descendants: 16, width: 36 },
  { min_descendants: 31, width: 52 }
]);
