// state/settings/fields/footprint.ts — the asphalt slab under the city. One
// quad per layout rect, each inflated by HALO_WIDTH so the overlapping quads
// compose into one continuous silhouette. Tree placement reads HALO_WIDTH too,
// so candidates inside the slab fall out of the existing rbush overlap check.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settings/schema';

// Its own object store because HALO_WIDTH is threaded into the tree-placement
// worker.
const FOOTPRINT_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'When off, the slab is hidden and trees can grow inside the halo area.',
  },
  COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#0a0b0f',
    label: 'Color',
    tip: 'Slab color; near-black by default so it reads as a darker frame around the city.',
  },
  HALO_WIDTH: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 24,
    min: 0,
    max: 256,
    step: 4,
    label: 'Halo width',
    tip: 'World units of asphalt added outward around every layout rect. Above 256 the halo dwarfs the city and reads as a paved plaza.',
  },
  CORNER_RADIUS: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 2.0,
    min: 0,
    max: 2,
    step: 0.05,
    label: 'Halo radius × halo width',
    tip: 'Corner roundness as a multiple of Halo width: 0 is sharp, 2 rounds by two halo widths. Only shows where the silhouette ends, not where rects overlap.',
  },
} satisfies FieldMap;

export const FOOTPRINT = settingSignal('FOOTPRINT', FOOTPRINT_FIELDS);
export type FootprintConfig = ConfigOf<typeof FOOTPRINT_FIELDS>;
