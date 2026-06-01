// state/stores/settings/trees.ts — Commit-driven tree configuration.
//
// One tree per commit, scattered around the world floor (denser near the city)
// sorted by distance to the gem (oldest commit closest). Visual signals:
//   HEIGHT  ← commit AGE  (older = taller)
//   WIDTH   ← commit FILES (more files = wider)
//   COLOR   ← COMMITS-PER-DAY (solo-day vs busy-day interpolation), optionally
//             age-desaturated toward gray for older commits.
//
// Schema-driven (see state/schema): a flat field map per store; the
// persisted defaults + the config TYPE are both derived from it. How these
// fields are grouped in the Settings panel lives in views/controls.

import { settingSignal, FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '@/state/schema';

const TREES_FIELDS = {
  ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Trees enabled',
    tip: 'Master toggle. When off, all tree canopies + trunks are hidden (mesh.visible flip — no rebuild).' },

  EDGE_INSET_PERCENT: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 1, min: 0, max: 50, step: 1, label: 'Edge inset (% of plane)',
    tip: 'Trees stop short of the plane edge by this fraction of the SHORTER axis. Rebuild on change.' },
  DENSITY_FALLOFF: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 1.5, min: 0, max: 50, step: 0.1, label: 'Density falloff',
    tip: 'How tightly trees cluster near the city. 0 = uniform spread. Higher = denser near city, sparser at edges (acceptance prob = (1 - dist/maxDist)^falloff). Very high values (>20) push almost every tree into a dense ring right at the city edge. Rebuild on change.' },

  COLOR_BUSY_DAY: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#001908', label: 'Busy-day color',
    tip: 'Color for commits on a busy day — many commits sharing the same date. Live.' },
  COLOR_SOLO_DAY: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#5a370a', label: 'Solo-day color',
    tip: 'Color for commits on a solo day — only one commit that date. Live.' },
  TRUNK_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#110c08', label: 'Trunk color',
    tip: 'Color of every tree trunk. Live.' },
  SHADING_STRENGTH: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.65, min: 0, max: 1, step: 0.05, label: 'Shading strength',
    tip: 'Baked vertex-color gradient depth on the canopy. 0 = flat (no shading), 1 = fully dark at the base. Rebuild on change.' },

  AGE_DESAT_ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: false, label: 'Age desaturation enabled',
    tip: 'When on, older commits fade toward gray — newest commits keep full color, oldest are washed out. Live.' },
  AGE_SATURATION: { route: ChangeRoute.Refresh, kind: FieldKind.RangePair, default: [50, 100] as [number, number], min: 0, max: 100, step: 1, label: 'Saturation range',
    tip: 'Saturation retained at the OLDEST (left) and NEWEST (right) commit — percent 0–100. At 20 the oldest tree keeps only 20% of its base color saturation; at 100 it is fully saturated. Live.' },

  MIN_HEIGHT: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 8, min: 4, max: 400, step: 4, label: 'Min height',
    tip: 'Height (world units) of the newest commit. Older commits grow taller toward Max. Independent of building dimensions. Rebuild on change.' },
  MAX_HEIGHT: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 96, min: 16, max: 800, step: 4, label: 'Max height',
    tip: 'Height (world units) of the oldest commit. Independent of building dimensions. Rebuild on change.' },
  TRUNK_HEIGHT_FRAC: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.35, min: 0.05, max: 1, step: 0.05, label: 'Trunk height (% of canopy)',
    tip: 'Trunk height as a fraction of canopy height. Larger = more visible trunk relative to canopy. Rebuild on change.' },
  CANOPY_TRUNK_OVERLAP_FRAC: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.1, min: 0, max: 1, step: 0.05, label: 'Canopy-trunk overlap (% of trunk)',
    tip: 'How much of the trunk top is hidden inside the canopy. 0 = canopy bottom point touches trunk top. 1 = canopy bottom reaches the ground, hiding the entire trunk. Rebuild on change.' },

  MIN_WIDTH: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 32, min: 2, max: 400, step: 2, label: 'Min canopy width',
    tip: 'Canopy diameter (world units) of commits with the fewest files changed. Independent of building dimensions. Rebuild on change.' },
  MAX_WIDTH: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 64, min: 4, max: 600, step: 2, label: 'Max canopy width',
    tip: 'Canopy diameter (world units) of commits with the most files changed. Independent of building dimensions. Rebuild on change.' },
  TRUNK_RADIUS_FRAC: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.15, min: 0.05, max: 0.5, step: 0.01, label: 'Trunk thickness (% of canopy)',
    tip: 'Trunk XZ radius as a fraction of canopy radius. Wider canopies get thicker trunks proportionally. Rebuild on change.' },
  WIDTH_AGE_FLOOR: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.5, min: 0, max: 1, step: 0.05, label: 'Age shrink floor',
    tip: 'Multiplier on file-driven canopy width at the SHORTEST (newest) tree. 1 = no shrink; 0.5 = half-width saplings; 0 = strict height-proportional. Tallest trees always render at full width. Rebuild on change.' },

  FACETS_LOW: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 5, min: 3, max: 24, step: 1, label: 'Low-tier facets',
    tip: 'Radial segment count for trees in the smallest-commit tier. 3 = triangular prism (chunkiest); higher = smoother. Lowest tier holds the largest tree count so this is the perf-sensitive knob.' },
  FACETS_MID: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 8, min: 3, max: 24, step: 1, label: 'Mid-tier facets',
    tip: 'Radial segment count for the middle-commit tier.' },
  FACETS_HIGH: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 12, min: 3, max: 32, step: 1, label: 'High-tier facets',
    tip: 'Radial segment count for the largest-commit tier. Highest tier has the fewest tree instances so this is the cheapest knob to push high.' },

  // Hover / select wireframe outlines — two persistent LineSegments2 meshes
  // snap to the active tree's transform per frame (treeOutlineRenderer). One
  // shared width; hover/selected differ by color (white vs animated rainbow
  // via RAINBOW). Folded in from the former TREE_OUTLINE store.
  OUTLINE_WIDTH: { route: ChangeRoute.Refresh, kind: FieldKind.Number, default: 1, min: 1, max: 10, step: 1, label: 'Linewidth',
    tip: 'Pixel thickness shared by hover and selected canopy outlines.' },
  OUTLINE_HOVER_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#ffffff', label: 'Hover color',
    tip: 'Outline color when a tree is hovered (not selected).' },
  OUTLINE_HOVER_OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.5, min: 0, max: 1, step: 0.05, label: 'Hover opacity' },
  OUTLINE_SELECTED_OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.75, min: 0, max: 1, step: 0.05, label: 'Selected opacity',
    tip: 'Selected outline uses an animated rainbow color — see Effects > Rainbow.' },
} satisfies FieldMap;

export const TREES = settingSignal('TREES', TREES_FIELDS);
export type TreesConfig = ConfigOf<typeof TREES_FIELDS>;
