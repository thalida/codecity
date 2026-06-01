// state/stores/settings/facade.ts — Procedural facade rendering controls as one flat
// FACADE store: window/door/roof geometry, HSL contrast deltas, per-cell window
// lighting, and the media-building ad panels (folded in here).
//
// Schema-driven (see state/schema); each field states its own route:
//   • Geometry shader-side (*_FRAC), all detail + window-lighting keys → Refresh
//     (refreshBuildingMaterial pushes uniforms; cheap).
//   • Geometry JS-side (WINDOW_COLS_MAX, WIDTH_PER_WINDOW_COL, DOOR_WIDTH_FRAC)
//     and the ad-panel keys → Rebuild (bake into per-instance attributes /
//     panel geometry at manifest-apply time).
//
// Consumers do NOT clamp — the UI gates ranges; degenerate inputs render weird
// but never crash. AD_ERROR_COLOR (load-failure tint) was never a UI control,
// so it lives in constants/buildings.ts.

import { settingSignal, FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '@/state/settingsSchema';

const FACADE_FIELDS = {
  // ── Geometry — shader-side (*_FRAC), refresh ──
  SLAB_HEIGHT_FRAC: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.05, min: 0, max: 0.4, step: 0.01, label: 'Slab thickness × floor',
    tip: "Floor-slab strip height as a fraction of one floor. Above 0.4 the slab eats more than the floor's window band — the facade reads as horizontal banding instead of windowed." },
  WINDOW_WIDTH_FRAC: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.5, min: 0, max: 1, step: 0.01, label: 'Window width × cell',
    tip: 'Window width as a fraction of its grid cell.' },
  WINDOW_HEIGHT_FRAC: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.45, min: 0, max: 1, step: 0.01, label: 'Window height × floor',
    tip: 'Window height as a fraction of one floor.' },
  WINDOW_MARGIN_FRAC: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.08, min: 0, max: 0.2, step: 0.005, label: 'Window margin × face',
    tip: 'Horizontal margin per edge of the window grid, as a fraction of face width. Above 0.2 there is only room for ~3 window columns on a typical building.' },
  DOOR_HEIGHT_FRAC: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.75, min: 0, max: 1, step: 0.01, label: 'Door height × floor',
    tip: 'Door height as a fraction of one floor.' },
  ROOF_BORDER_FRAC: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.05, min: 0, max: 0.1, step: 0.005, label: 'Roof border × face',
    tip: 'Width of the roof border strip, as a fraction of the face. Above 0.1 (10% of face width) the border eats into the icon area at the top of the facade.' },

  // ── Geometry — JS-side (baked attributes), rebuild ──
  WINDOW_COLS_MAX: { route: ChangeRoute.Rebuild, kind: FieldKind.Number, default: 8, min: 1, max: 10, step: 1, label: 'Max window columns',
    tip: 'Hard cap on window columns per face. Rebuild required. Above 10 the window grid becomes too dense to read at typical zoom.' },
  WIDTH_PER_WINDOW_COL: { route: ChangeRoute.Rebuild, kind: FieldKind.Number, default: 12, min: 1, max: 32, step: 1, label: 'Width per window col',
    tip: 'World-unit width allotted per window column (cols = floor(buildingWidth / this)). Rebuild required. Above 32 world units per column, small buildings end up with zero windows.' },
  DOOR_WIDTH_FRAC: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.4, min: 0, max: 1, step: 0.05, label: 'Door width',
    tip: "Door width as a fraction of the building's own width. Bigger buildings get proportionally wider doors. Rebuild required." },

  // ── Contrast (HSL lightness Δ) — refresh ──
  SLAB_LIGHTNESS_DELTA: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: -10, min: -100, max: 100, step: 1, label: 'Floor slab',
    tip: 'Lightness offset for the floor-slab strip, in HSL percentage points (negative darkens).' },
  DOOR_LIGHTNESS_DELTA: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: -50, min: -100, max: 100, step: 1, label: 'Door',
    tip: 'Lightness offset for the door (negative darkens).' },
  ROOF_BORDER_LIGHTNESS_DELTA: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: -10, min: -100, max: 100, step: 1, label: 'Roof border',
    tip: 'Lightness offset for the roof border strip (negative darkens).' },

  // ── Window lighting — refresh ──
  UNLIT_LIGHTNESS_DELTA: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: -4, min: -20, max: 20, step: 1, label: 'Unlit pane lightness Δ',
    tip: 'HSL lightness offset applied to unlit panes (relative to the building hue).' },
  GAP_BASE_THRESHOLD: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.25, min: 0, max: 1, step: 0.01, label: 'Gap fraction (base)',
    tip: 'Base fraction of cells with no window at all (architectural gaps).' },
  GAP_AGE_BONUS: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.5, min: 0, max: 1, step: 0.01, label: 'Gap fraction (age bonus)',
    tip: 'Extra empty-cell fraction added for the oldest building (interpolates down to 0 for the newest).' },
  LIT_FRESHNESS_EXPONENT: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 2.0, min: 1, max: 4, step: 0.1, label: 'Lit-window dim curve',
    tip: 'Exponent on the recency curve that drives lit-window count + HDR emission. 1 = linear; higher dims mid-age buildings faster so only the freshest ones glow. Beyond 4 only the newest ~6% of files visibly emit.' },
  DIM_GLOW_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#806626', label: 'Old building glow',
    tip: 'Warm-amber tint that lit panes drift toward as the file ages (created-date axis, not last-modified).' },

  // ── Ad panels (media files) — rebuild (geometry baked at apply time) ──
  AD_SIDE_MARGIN_FRAC: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 0.1, min: 0, max: 0.4, step: 0.01, label: 'Side margin × width',
    tip: 'Horizontal margin on each side of the building width — controls how much building wall is visible to the left and right of the ad. Above 0.4 the margins consume more than 80% of the face and the ad becomes a sliver.' },
  AD_BOTTOM_OFFSET_FLOORS: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 1.0, min: 0, max: 3, step: 0.1, label: 'Bottom offset × floors',
    tip: 'Ad bottom edge sits this many floor heights above the ground — guarantees the door (0.75 of a floor tall) stays uncovered. 1.0 leaves a clean strip; raise it to lift the ad higher on the building.' },
  AD_PLACEHOLDER_COLOR: { route: ChangeRoute.Rebuild, kind: FieldKind.Color, default: '#29293d', label: 'Placeholder color',
    tip: 'Color shown on the ad plane while the texture is loading (or if the load fails).' },
} satisfies FieldMap;

export const FACADE = settingSignal('FACADE', FACADE_FIELDS);
export type FacadeConfig = ConfigOf<typeof FACADE_FIELDS>;
