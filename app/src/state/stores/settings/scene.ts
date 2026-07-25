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
    tip: "Solid color of the sky. Past the island's edge the camera sees this directly, so the island reads as floating in space.",
  },

  // ── Stars ──
  STARS_ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'When off, no stars or twinkle appear.',
  },
  STARS_DENSITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.0075,
    min: 0,
    max: 0.02,
    step: 0.0005,
    label: 'Density',
    tip: 'Higher values paint more stars. Above ~0.01 the sky reads as a noise field.',
  },

  // ── Aurora ──
  AURORA_ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'When off, no aurora appears.',
  },
  AURORA_INTENSITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.022,
    min: 0,
    max: 0.15,
    step: 0.002,
    label: 'Intensity',
    tip: 'Peak brightness of the aurora bands. Kept low so they read as a faint nebula and stay under the bloom threshold.',
  },

  // ── Ground haze (fog) ──
  FOG_ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'When off, there is no haze. Turning it back on restores the other fog settings below.',
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
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Intensity',
    tip: 'Peak fog amount at street level. 0 turns it off, 1 fully tints the ground to the fog color.',
  },
  FOG_HEIGHT_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Falloff height ×',
    tip: "How much of each building the haze covers, as a fraction of that building's own height. 0.5 hazes the bottom half of every building, so a 2-floor stub and a 60-floor tower wear the same relative skirt.",
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
    tip: "Padding around the city as a percentage of the city's longest dimension. 0% fits the island exactly to the city; 50% adds a generous halo of bare ground.",
  },
} satisfies FieldMap;

export const WORLD = settingSignal('WORLD', WORLD_FIELDS);
export type WorldConfig = ConfigOf<typeof WORLD_FIELDS>;
