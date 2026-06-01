// state/stores/settings/island.ts — Floating-island world-plane configuration: one
// flat store for the whole island (silhouette/depth geometry + baked vertex
// colors + hemispheric lighting). The Geometry/Materials split is purely a
// Settings-panel grouping, declared in sections/island.ts — not separate
// stores. Schema-driven (see state/schema); applied on Save via
// applyTheme() — islandMesh.applyConfig() pulls fresh values.

import { settingSignal, FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '@/state/settingsSchema';

const ISLAND_FIELDS = {
  // ── Geometry ──
  ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Show island',
    tip: 'Master toggle for the floating-island mesh. When off, the city sits over empty sky.' },
  SIDES: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 32, min: 6, max: 48, step: 1, label: 'Polygon sides',
    tip: 'How many sides the island top has. Also drives triangle density horizontally — each side contributes 2 triangles per tier band. 6 = hexagon (chunky big facets); 12 = dodecagon (default); 48 = lots of small facets.' },
  IRREGULARITY: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.12, min: 0, max: 0.5, step: 0.01, label: 'Irregularity',
    tip: '0 = perfectly regular polygon. Higher values jitter vertices inward for a natural island silhouette.' },
  TIERS: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 5, min: 1, max: 10, step: 1, label: 'Tier rings',
    tip: 'How many chunky tier rings make up the underside. 1 = sharp cone; 4–6 = chunky tapered look; 10 = lots of facet detail.' },
  DEPTH: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 1.2, min: 0.2, max: 2.0, step: 0.05, label: 'Depth (× radius)',
    tip: 'Total island depth as a fraction of island radius. Larger = deeper, more "iceberg" silhouette.' },
  ROUNDNESS: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.7, min: 0, max: 1, step: 0.05, label: 'Roundness',
    tip: 'Body shape. 0 = pointed taper to a tip; 1 = very rounded bowl. 0.7 = the current default smooth-rounded shape.' },
  GRASS_THICKNESS: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.025, min: 0, max: 0.1, step: 0.005, label: 'Grass thickness',
    tip: 'Vertical thickness of the green grass layer as a fraction of island radius. 0 = no grass band, just the flat top.' },

  // ── Materials ──
  GRASS_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#18341f', label: 'Grass color',
    tip: 'Top surface where the city sits.' },
  GRASS_SIDE_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#214529', label: 'Grass side color',
    tip: 'Vertical band wrapping the top edge. Side faces point outward, so hemispheric lighting hits them very differently than the top — tune this brighter than Grass color if the side band reads too dim.' },
  ROCK_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#71778e', label: 'Rock color',
    tip: 'Uniform rock/earth color for the cliff band, tier rings, and bottom cap. Per-face lighting provides all the visual variation.' },
  HEMI_SKY_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#e8f6fc', label: 'Hemi sky color',
    tip: 'Warm "from above" tone blended onto upward-facing surfaces by the hemispheric lighting model.' },
  HEMI_GROUND_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#031117', label: 'Hemi ground color',
    tip: 'Cool "from below" tone blended onto downward-facing surfaces by the hemispheric lighting model.' },
} satisfies FieldMap;

export const ISLAND = settingSignal('ISLAND', ISLAND_FIELDS);
export type IslandConfig = ConfigOf<typeof ISLAND_FIELDS>;
