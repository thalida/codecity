// state/stores/settings/island.ts — Floating-island world-plane. ISLAND is the
// island itself (silhouette, depth, baked colors, hemispheric lighting); WORLD
// sizes the ground it's cut from. Schema-driven (see state/schema); applied via
// the island component's settings effect (city/components/island/index.ts).

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const ISLAND_FIELDS = {
  // ── Geometry ──
  ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Show island',
    tip: 'Master toggle for the floating-island mesh. When off, the city sits over empty sky.',
  },
  SIDES: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 32,
    min: 6,
    max: 48,
    step: 1,
    label: 'Polygon sides',
    tip: 'How many sides the island top has: 6 is a chunky hexagon, 12 the default dodecagon, 48 lots of small facets.',
  },
  IRREGULARITY: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.12,
    min: 0,
    max: 0.5,
    step: 0.01,
    label: 'Irregularity',
    tip: '0 is a perfectly regular polygon. Higher values jitter vertices inward for a natural island silhouette.',
  },
  TIERS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 5,
    min: 1,
    max: 10,
    step: 1,
    label: 'Tier rings',
    tip: 'How many chunky tier rings make up the underside. 1 is a sharp cone, 4 to 6 a chunky tapered look, 10 lots of facet detail.',
  },
  DEPTH: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 1.2,
    min: 0.2,
    max: 2.0,
    step: 0.05,
    label: 'Depth (× radius)',
    tip: 'Total island depth as a fraction of island radius. Larger is a deeper, more "iceberg" silhouette.',
  },
  ROUNDNESS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Roundness',
    tip: 'Body shape: 0 tapers to a point, 1 is a very rounded bowl.',
  },
  GRASS_THICKNESS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.025,
    min: 0,
    max: 0.1,
    step: 0.005,
    label: 'Grass thickness',
    tip: 'Vertical thickness of the green grass layer as a fraction of island radius. 0 leaves no grass band, just the flat top.',
  },

  // ── Materials ──
  GRASS_TEXTURE: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Grass texture',
    tip: 'How much the grass varies in lightness, patch to patch. 0 is flat.',
  },
  GRASS_PATCH_SIZE: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Number,
    default: 256,
    min: 10,
    max: 600,
    step: 10,
    label: 'Grass patch size',
    tip: 'World units across one patch of grass. Smaller reads as finer ground detail.',
  },
  ROCK_TEXTURE: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Rock texture',
    tip: 'How much the rock varies in lightness, patch to patch. 0 is flat.',
  },
  ROCK_PATCH_SIZE: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Number,
    default: 512,
    min: 10,
    max: 1200,
    step: 10,
    label: 'Rock patch size',
    tip: 'World units across one patch of rock. Larger than the grass reads as strata.',
  },
  GRASS_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#18341f',
    label: 'Grass color',
    tip: 'Top surface where the city sits.',
  },
  GRASS_SIDE_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#214529',
    label: 'Grass side color',
    tip: 'Vertical band wrapping the top edge. It faces outward, so lighting tends to hit it dimmer than the top, brighten it if the side band looks too dark.',
  },
  ROCK_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#71778e',
    label: 'Rock color',
    tip: 'Uniform rock/earth color for the cliff band, tier rings, and bottom cap.',
  },
  HEMI_SKY_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#e8f6fc',
    label: 'Hemi sky color',
    tip: 'Warm tone blended onto upward-facing surfaces, as if lit from above.',
  },
  HEMI_GROUND_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#031117',
    label: 'Hemi ground color',
    tip: 'Cool tone blended onto downward-facing surfaces, as if lit from below.',
  },
} satisfies FieldMap;

export const ISLAND = settingSignal('ISLAND', ISLAND_FIELDS);
export type IslandConfig = ConfigOf<typeof ISLAND_FIELDS>;

// Sets the island's extent (getWorldBounds → buildTopPolygon). Separate store
// so the tree-placement worker snapshot doesn't carry the island's visuals.
const WORLD_FIELDS = {
  GROUND_BUFFER_PERCENT: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    label: 'Ground buffer (% of city)',
    tip: "Padding around the city as a percentage of the city's longest dimension. 0% fits the island exactly to the city; 50% adds a generous halo of bare ground.",
  },
} satisfies FieldMap;

export const WORLD = settingSignal('WORLD', WORLD_FIELDS);
export type WorldConfig = ConfigOf<typeof WORLD_FIELDS>;
