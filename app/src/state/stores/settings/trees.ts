// state/stores/settings/trees.ts — Commit-driven tree configuration.
//
// One tree per commit, scattered around the world floor (denser near the city)
// sorted by distance to the gem (oldest commit closest). Visual signals:
//   HEIGHT  ← commit AGE (older = taller), blended from rank within the repo
//             and real age (HORIZON_DAYS / RELATIVE_WEIGHT), so an abandoned
//             repo reads old across the whole forest, not just at its old end.
//   WIDTH   ← commit FILES (more files = wider)
//   COLOR   ← COMMITS-PER-DAY (solo-day vs busy-day interpolation).
//
// Schema-driven (see state/schema): a flat field map per store; the
// persisted defaults + the config TYPE are both derived from it. How these
// fields are grouped in the Settings panel lives in views/controls.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const TREES_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Trees enabled',
    tip: 'Master toggle. When off, every tree canopy and trunk is hidden.',
  },

  COLOR_BUSY_DAY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#001908',
    label: 'Busy-day color',
    tip: 'Color for commits made on a busy day, when many commits share the same date.',
  },
  COLOR_SOLO_DAY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#5a370a',
    label: 'Solo-day color',
    tip: 'Color for commits made on a solo day, the only commit on that date.',
  },
  TRUNK_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#110c08',
    label: 'Trunk color',
    tip: 'Color of every tree trunk.',
  },
  SHADING_STRENGTH: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.65,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Shading strength',
    tip: 'Shading depth on the canopy. 0 is flat, 1 is fully dark at the base.',
  },

  MIN_HEIGHT: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 8,
    min: 4,
    max: 400,
    step: 4,
    label: 'Min height',
    tip: 'Tree height for the newest commit, independent of building size. Older commits grow taller toward Max height.',
  },
  MAX_HEIGHT: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 96,
    min: 16,
    max: 800,
    step: 4,
    label: 'Max height',
    tip: 'Tree height for the oldest commit.',
  },
  HORIZON_DAYS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 1825,
    min: 30,
    max: 3650,
    step: 10,
    label: 'Age horizon (days)',
    tip: 'How old a commit must be to reach the fully-grown look. Longer keeps a decade of history spread across the height range; shorter makes anything past it read equally old.',
  },
  RELATIVE_WEIGHT: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Relative weight',
    tip: 'How much height comes from a commit rank within this repo versus its actual age. 1 sizes purely by rank, so an abandoned repo looks as fresh as an active one. 0 sizes purely by age, which flattens any history older than the horizon.',
  },

  TRUNK_HEIGHT_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.35,
    min: 0.05,
    max: 1,
    step: 0.05,
    label: 'Trunk height (% of canopy)',
  },
  CANOPY_TRUNK_OVERLAP_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Canopy-trunk overlap (% of trunk)',
    tip: 'How much of the trunk top hides inside the canopy. 0 means the canopy just touches the trunk top; 1 means it reaches the ground and hides the whole trunk.',
  },

  MIN_WIDTH: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 64,
    min: 2,
    max: 400,
    step: 2,
    label: 'Min canopy width',
    tip: 'Canopy diameter for commits that changed the fewest files, independent of building size.',
  },
  MAX_WIDTH: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 128,
    min: 4,
    max: 600,
    step: 2,
    label: 'Max canopy width',
    tip: 'Canopy diameter for commits that changed the most files.',
  },
  TRUNK_RADIUS_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.15,
    min: 0.05,
    max: 0.5,
    step: 0.01,
    label: 'Trunk thickness (% of canopy)',
  },
  WIDTH_AGE_FLOOR: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Age shrink floor',
    tip: 'Width multiplier for the shortest, newest trees. 1 means no shrink, 0.5 gives half-width saplings, 0 makes width strictly follow height. Tallest trees always render at full width.',
  },

  // Hover / select wireframe outlines — two persistent LineSegments2 meshes
  // snap to the active tree's transform per frame (treeOutlineRenderer). One
  // shared width; hover/selected differ by color (white vs animated rainbow
  // via RAINBOW). Folded in from the former TREE_OUTLINE store.
  OUTLINE_WIDTH: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Number,
    default: 1,
    min: 1,
    max: 10,
    step: 1,
    label: 'Linewidth',
    tip: 'Pixel thickness shared by hover and selected canopy outlines.',
  },
  OUTLINE_HOVER_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#ffffff',
    label: 'Hover color',
    tip: 'Outline color when a tree is hovered (not selected).',
  },
  OUTLINE_HOVER_OPACITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Hover opacity',
  },
  OUTLINE_SELECTED_OPACITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.75,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Selected opacity',
    tip: 'The selected outline always uses an animated rainbow color, tunable under Effects.',
  },
} satisfies FieldMap;

export const TREES = settingSignal('TREES', TREES_FIELDS);
export type TreesConfig = ConfigOf<typeof TREES_FIELDS>;
