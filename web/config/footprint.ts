// config/footprint.ts — Cyberpunk Valley city footprint configuration.
//
// One InstancedMesh per layout rect (buildings + streets + paths),
// each scaled up by HALO_WIDTH world units in both axes, painted with
// COLOR, drawn at y=0 between the valley floor (-500) and the city's
// sidewalk/asphalt layers (1+). The overlapping inflated quads
// compose visually into one continuous asphalt slab that follows the
// city silhouette.
//
// Parks placement reads HALO_WIDTH so candidate trees inside the slab
// are rejected by the existing rbush overlap check — no extra
// gradient logic required.

import { map } from 'nanostores';

export interface FootprintConfig {
  /** Master toggle. When false, the InstancedMesh is still built but
   *  its group is hidden (group.visible = false), and parks placement
   *  treats HALO_WIDTH as 0 (no rejection). */
  ENABLED: boolean;
  /** World units of asphalt added outward around each layout rect.
   *  The contour emerges from the union of overlapping inflated rects. */
  HALO_WIDTH: number;
  /** Corner radius as a fraction of HALO_WIDTH (0 = sharp; 1 = radius
   *  equals one halo width; 2 = two halo widths). World-units radius
   *  pushed to the shader = CORNER_RADIUS × HALO_WIDTH. Per-instance
   *  clamp to half the smallest side keeps tiny rects from degrading
   *  into pills. Where rects overlap heavily the rounding is hidden
   *  by neighbors; where a rect ends at the silhouette the radius
   *  shows. */
  CORNER_RADIUS: number;
  /** Slab color. A near-black tone that reads as a dark paved apron
   *  framing the city against the night-scene floor. */
  COLOR: string;
}

export const FOOTPRINT = map<FootprintConfig>({
  ENABLED: true,
  HALO_WIDTH: 32,
  // 1.25 × 32 = 40 wu radius. Above 1.0 means the rounding extends
  // past one halo width — corners read distinctly pill-like at the
  // city silhouette, which is the intended look.
  CORNER_RADIUS: 1.25,
  COLOR: '#0a0b0f',
});
