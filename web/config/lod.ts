// config/lod.ts — Per-cell LOD swap thresholds. Values are in screen-
// space pixel area: a cell whose projected bounding sphere covers more
// than SWAP_TO_DETAIL_PX pixels renders as detailed instances; below
// SWAP_TO_IMPOSTOR_PX it collapses to a cheap flat-shaded box; below
// CULL_PX it is hidden entirely.
// Two-threshold hysteresis avoids rapid swapping when a cell sits
// near the boundary.
//
// CAMERA_MOVE_EPS and VIEWPORT_RESIZE_EPS gate the per-frame LOD
// evaluation: if neither the camera nor the viewport has changed by
// more than the respective epsilon, the evaluation is skipped.
//
// User-tunable via the controls pane (added in a later phase if the
// defaults turn out to need adjustment per project type).

import { map } from 'nanostores';

export interface LodConfig {
  enabled: boolean;             // master switch — when off, all cells render at detail tier
  SWAP_TO_DETAIL_PX: number;    // expand to detailed instances above this
  SWAP_TO_IMPOSTOR_PX: number;  // collapse to flat box below this
  CULL_PX: number;              // hide entirely below this
  CAMERA_MOVE_EPS: number;      // world units; skip eval when camera hasn't moved this far
  VIEWPORT_RESIZE_EPS: number;  // px; skip eval when viewport hasn't resized by this much
}

export const LOD = map<LodConfig>({
  enabled: true,
  SWAP_TO_DETAIL_PX: 3000,
  SWAP_TO_IMPOSTOR_PX: 2000,
  CULL_PX: 50,
  CAMERA_MOVE_EPS: 0.5,
  VIEWPORT_RESIZE_EPS: 1,
});
