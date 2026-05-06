// config/lod.ts — Per-block LOD swap thresholds. Values are in screen-
// space pixel area: a block whose projected bounding box covers more
// than SWAP_TO_DETAIL_PX pixels renders as detailed instances; below
// SWAP_TO_PLACEHOLDER_PX it collapses to a single colored cuboid.
// Two-threshold hysteresis avoids rapid swapping when a block sits
// near the boundary.
//
// User-tunable via the controls pane (added in a later phase if the
// defaults turn out to need adjustment per project type).

import { map } from 'nanostores';

export interface LodConfig {
  SWAP_TO_DETAIL_PX: number;      // expand to detailed instances above this
  SWAP_TO_PLACEHOLDER_PX: number; // collapse to placeholder below this
}

export const LOD = map<LodConfig>({
  SWAP_TO_DETAIL_PX: 3000,
  SWAP_TO_PLACEHOLDER_PX: 2000,
});
