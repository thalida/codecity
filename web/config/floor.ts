// config/floor.ts — Cyberpunk Valley floor configuration. A single
// nanostore drives a large flat plane that sits below the city and
// grounds the scene visually — the dark counterpart to the SKY sphere
// above. Every key is live-editable from the Controls panel; no
// rebuild is required.
//
//   ENABLED   — master toggle. When false the floor mesh is hidden
//                and the existing scene.background GROUND color shows
//                through where the floor would have been (same fallback
//                as SKY_GRADIENT.ENABLED=false).
//   COLOR     — flat fill color. Near-black with a faint cyberpunk
//                purple hint so the skybox horizon (dark midnight
//                purple) and the floor read as adjacent but visually
//                distinct planes.
//   SIZE_MULT — plane edge length as a multiplier of
//                CAMERA_PERSPECTIVE.FAR. 0.9 keeps the floor inside
//                the sky sphere's radius (which is FAR × 0.95) so the
//                floor never pokes through the sky.
//   Y_OFFSET  — small negative offset (world units) so the floor sits
//                just under the city's ground plane (y=0) and any
//                coplanar z-fighting goes to the floor's loss, not the
//                city's sidewalk / asphalt stack.

import { map } from 'nanostores';

export interface FloorConfig {
  ENABLED: boolean;
  COLOR: string;
  SIZE_MULT: number;
  Y_OFFSET: number;
}

export const FLOOR = map<FloorConfig>({
  ENABLED: true,
  COLOR: '#080515',
  SIZE_MULT: 0.9,
  Y_OFFSET: -0.1,
});
