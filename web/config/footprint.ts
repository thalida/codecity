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
  /** Slab color. A near-black tone that reads as a dark paved apron
   *  framing the city against the night-scene floor. */
  COLOR: string;
}

export const FOOTPRINT = map<FootprintConfig>({
  ENABLED: true,
  HALO_WIDTH: 64,
  COLOR: '#0a0b0f',
});
