// state/stores/settings/scene.ts — Scene backdrop (sky color, stars, atmospheric fog)
// as one flat SCENE store, plus the WORLD ground-sizing store. WORLD stays
// separate because it's a layout value threaded into the tree-placement worker
// (keeping the worker snapshot lean) — not a backdrop visual; the Settings
// panel still groups it under "Ground sizing" via sections/scene.ts.
//
// Schema-driven (see state/schema). Sky/stars/fog are all material-
// refresh; GROUND_BUFFER_PERCENT triggers a rebuild.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const SCENE_FIELDS = {
  // ── Sky ──
  SKY_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#010005',
    label: 'Sky color',
    tip: 'Solid color painted across the entire sphere. Past the world floor edge the camera sees this color directly, so the plane reads as floating in space.',
  },

  // ── Stars ──
  STARS_ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'When off, no stars are sampled (also disables twinkle).',
  },
  STARS_DENSITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.0075,
    min: 0,
    max: 0.02,
    step: 0.0005,
    label: 'Density',
    tip: 'Hash-threshold for star presence — higher density paints MORE stars. Above ~0.01 the sky reads as a noise field.',
  },

  // ── Ground haze (fog) ──
  FOG_ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: "Off → no haze (the shader's fog mix is a no-op). Other knobs stay in config so flipping back restores the mood.",
  },
  FOG_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#0f0821',
    label: 'Color',
    tip: 'Tint that building bases mix toward. Match the sky/ground for a seamless horizon.',
  },
  FOG_INTENSITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.8,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Intensity',
    tip: 'Peak fog amount at world Y=0 (street level). 0 = off; 1 = ground plane fully tinted to fog color.',
  },
  FOG_HEIGHT_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Falloff height ×',
    tip: 'Half-fall-off height as a fraction of the tallest possible building (BUILDING_DIMENSIONS.MAX_FLOORS × FLOOR_HEIGHT). Auto-scales with the building config so the mist sits in the same relative band of the skyline. 0.25 = mist fades by mid-height of short buildings; 0.5 = halfway up the tallest.',
  },
} satisfies FieldMap;

export const SCENE = settingSignal('SCENE', SCENE_FIELDS);
export type SceneConfig = ConfigOf<typeof SCENE_FIELDS>;

// Ground sizing — a layout value (worldBounds + the placement worker read it),
// kept as its own store so the worker snapshot doesn't carry backdrop visuals.
const WORLD_FIELDS = {
  GROUND_BUFFER_PERCENT: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    label: 'Ground buffer (% of city)',
    tip: "Padding around the city as a percentage of the city's longest dimension. 0% = island exactly fits the city; 50% = generous halo of bare ground past the buildings.",
  },
} satisfies FieldMap;

export const WORLD = settingSignal('WORLD', WORLD_FIELDS);
export type WorldConfig = ConfigOf<typeof WORLD_FIELDS>;
