// config/lod.ts — Per-cell LOD thresholds, expressed as a FRACTION of
// the viewport's pixel area. Internally the evaluator multiplies these
// fractions by `viewport.width * viewport.height` to get a px² target,
// which is compared against each cell's projected bounding-sphere area.
//
// Why fractions instead of absolute pixel counts: the SpatialGrid's
// cell size scales with the layout's world bounds (tiny for codecity,
// huge for the Linux kernel), so a fixed pixel-area threshold required
// per-repo tuning. Viewport-coverage fractions are world-scale-
// independent AND resolution-independent — "render at detail when a
// cell covers ≥ 2.5% of my screen" works the same on any repo at any
// monitor resolution.
//
// Two-threshold hysteresis avoids rapid swapping when a cell sits
// near the boundary: a cell in 'detail' stays there until its area
// drops below IMPOSTOR_VIEWPORT_FRAC (not DETAIL_VIEWPORT_FRAC).
//
// CAMERA_MOVE_EPS and VIEWPORT_RESIZE_EPS gate the per-frame LOD
// evaluation: if neither the camera nor the viewport has changed by
// more than the respective epsilon, the evaluation is skipped.

import { map } from 'nanostores';

export interface LodConfig {
  enabled: boolean;                  // master switch — when off, all cells render at detail tier
  DETAIL_VIEWPORT_FRAC: number;      // 0..1; cell needs >= this fraction of viewport area to be detail
  IMPOSTOR_VIEWPORT_FRAC: number;    // 0..1; hysteresis band lower bound — below this, drop to impostor
  CULL_VIEWPORT_FRAC: number;        // 0..1; below this fraction, hide cell entirely
  CAMERA_MOVE_EPS: number;           // world units; skip eval when camera hasn't moved this far
  VIEWPORT_RESIZE_EPS: number;       // px; skip eval when viewport hasn't resized by this much
}

export const LOD = map<LodConfig>({
  enabled: true,
  // 2.5% of viewport — at 1920×1080 ≈ 52k px², roughly equivalent to the
  // previous absolute default of 3000 px² for small repos but scales up
  // automatically on Linux-sized worlds.
  DETAIL_VIEWPORT_FRAC: 0.025,
  // 0.5% of viewport — at 1920×1080 ≈ 10k px². Hysteresis band of
  // 0.5% → 2.5% gives ~5× distance buffer between tier swaps so the
  // user can't easily wiggle the camera into thrash.
  IMPOSTOR_VIEWPORT_FRAC: 0.005,
  // 0.005% of viewport — at 1920×1080 ≈ 100 px², i.e. a cell shrinking
  // to a ~10×10 pixel speck drops out entirely.
  CULL_VIEWPORT_FRAC: 0.00005,
  CAMERA_MOVE_EPS: 0.5,
  VIEWPORT_RESIZE_EPS: 1,
});
