// state/stores/settings/footprint.ts — Cyberpunk Valley city footprint configuration.
//
// One InstancedMesh per layout rect (buildings + streets + paths),
// each scaled up by HALO_WIDTH world units in both axes, painted with
// COLOR, drawn at y=0 between the valley floor (-500) and the city's
// sidewalk/asphalt layers (1+). The overlapping inflated quads
// compose visually into one continuous asphalt slab that follows the
// city silhouette.
//
// Tree placement reads HALO_WIDTH so candidate trees inside the slab
// are rejected by the existing rbush overlap check — no extra
// gradient logic required.

import { settingSignal, FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '@/state/settingsSchema';

// Schema-driven (see state/schema), but stays its own object store
// because HALO_WIDTH is threaded into the tree-placement worker. HALO_WIDTH
// bakes into per-instance Matrix4 data → rebuild; ENABLED / CORNER_RADIUS /
// COLOR are material/visibility updates → refresh.
const FOOTPRINT_FIELDS = {
  ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Enabled',
    tip: 'When off, the slab is hidden (still built; group.visible = false) and tree/bush placement no longer rejects candidates inside the halo.' },
  COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#0a0b0f', label: 'Color',
    tip: 'Slab color. Near-black by default so the apron reads as a darker frame around the city against the night-scene floor.' },
  HALO_WIDTH: { route: ChangeRoute.Rebuild, kind: FieldKind.Number, default: 24, min: 0, max: 256, step: 4, label: 'Halo width',
    tip: 'World units of asphalt added outward around every layout rect. ~32 (one narrow-street width) is the design default; above 256 the halo dwarfs the city and reads as a paved plaza.' },
  CORNER_RADIUS: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 2.0, min: 0, max: 2, step: 0.05, label: 'Halo radius × halo width',
    tip: 'Corner radius as a fraction of Halo width (0 = sharp, 1 = one halo width, 2 = two). World-units radius pushed to the shader = this × Halo width. Where rects overlap heavily the rounding is hidden by neighbors; the radius only shows where a rect ends at the silhouette.' },
} satisfies FieldMap;

export const FOOTPRINT = settingSignal('FOOTPRINT', FOOTPRINT_FIELDS);
export type FootprintConfig = ConfigOf<typeof FOOTPRINT_FIELDS>;
