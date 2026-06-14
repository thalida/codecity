// state/stores/settings/buildings.ts — Everything about a building's settings,
// in two stores:
//   BUILDING_DIMENSIONS — floors + width + road gap. Its OWN store because the
//     layout + tree-placement workers reconstruct it off-thread; all rebuild.
//   BUILDINGS — every main-thread visual knob, one flat store: palette, outline,
//     transition timing, facade geometry + contrast + window lighting + ad
//     panels, createdAge weathering (grime + tilt), and the selection-fade tier
//     matrix. Each field states its own route (Rebuild | Refresh | Live).
//
// Schema-driven (see state/schema). The big per-extension hue default lives in
// constants/buildings.ts.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';
import { DEFAULT_HUE_EXT_MAP } from '@/constants/buildings';
import { FadeDetail } from '@/types';

const FADE_DETAIL_OPTIONS = [
  { value: FadeDetail.Full, label: 'Full' },
  { value: FadeDetail.Silhouette, label: 'Silhouette' },
  { value: FadeDetail.Hidden, label: 'Hidden' },
];

// ─── Dimensions ────────────────────────────────────────────────────────────
// Floors and width are BOTH normalized against the project's own range:
// smallest file → MIN, largest → MAX. Floors uses sqrt-interpolation across
// line counts, width uses log-interpolation across byte sizes (file sizes
// span many orders of magnitude). Both auto-adapt per project — no absolute
// "size ceiling" anchor that punishes small repos with thin buildings or
// crushes large repos to all-the-same width.
//
// MIN/MAX are kept as separate scalar keys (not one RangePair array) because
// the layout/placement math reads each independently — same as TREES width.
// Worker-threaded (layout + tree-placement workers reconstruct it), so it
// stays its own object store. All rebuild-required.
const BUILDING_DIMENSIONS_FIELDS = {
  MIN_FLOORS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 2,
    min: 1,
    max: 200,
    step: 1,
    label: 'Min floors',
    tip: "Floors for the smallest file in the project (fewest lines). Sqrt-interpolated up to Max across the project's line-count range.",
  },
  MAX_FLOORS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 64,
    min: 1,
    max: 200,
    step: 1,
    label: 'Max floors',
    tip: 'Floors for the largest file (most lines). Above ~200 the tallest buildings dwarf the city.',
  },
  FLOOR_HEIGHT: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 16,
    min: 1,
    max: 50,
    step: 1,
    label: 'Floor height',
    tip: 'Vertical world units per floor (multiplier on the floor count). Above 50 the floor-to-width aspect breaks readability.',
  },
  MIN_WIDTH: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 16,
    min: 1,
    max: 200,
    step: 1,
    label: 'Min width',
    tip: "Footprint width for the smallest file (fewest bytes). Log-interpolated up to Max across the project's byte-size range. Footprints are square (depth = width).",
  },
  MAX_WIDTH: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 128,
    min: 1,
    max: 200,
    step: 1,
    label: 'Max width',
    tip: 'Footprint width for the largest file (most bytes).',
  },
  DISTANCE_FROM_ROAD: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    label: 'Distance from road',
    tip: 'Gap between the building wall and the street edge. Same for every building.',
  },
} satisfies FieldMap;

export const BUILDING_DIMENSIONS = settingSignal('BUILDING_DIMENSIONS', BUILDING_DIMENSIONS_FIELDS);
export type BuildingDimensionsConfig = ConfigOf<typeof BUILDING_DIMENSIONS_FIELDS>;

// ─── Buildings visual store (all main-thread building knobs) ─────────────────
// One flat store for everything that paints on top of the (separate,
// worker-threaded) dimensions. Sub-features are key-prefixed:
//   SATURATION_/LIGHTNESS_/HUE_EXT_MAP — HSL palette (rebuild: bakes into
//     per-building facade textures via buildingColor).
//   OUTLINE_*                          — wireframe outline (refresh: shared
//     material uniform / outlineRenderer).
//   BUILDING_TRANSITION_MS             — enter/stay tween length (live: the
//     animator reads it fresh per transition, no reaction).
//   SLAB_/WINDOW_/DOOR_/ROOF_/*_LIGHTNESS_DELTA/GAP_/LIT_/DIM_GLOW_COLOR
//                                      — procedural facade geometry + contrast +
//     window lighting (mostly refresh; the JS-side *_COLS/WIDTH_PER/DOOR_WIDTH
//     keys rebuild since they bake into per-instance attributes).
//   AD_*                               — media-building ad panels (rebuild;
//     geometry baked at apply time).
//   GRIME_/TILT_                       — createdAge weathering (refresh:
//     refreshBuildingMaterial uniforms, lerped per-building by age).
//   DEFAULT_/LEVEL1..4_                — selection-fade tier matrix (live: the
//     fader applies it directly; see the tier comment below).
//
// Saturation/lightness MIN/MAX stay separate scalar keys (read independently
// by buildingColor), same rationale as dimensions.
//
// Fade tiers route Live: the fader applies them via its own effect (subscribing
// to BUILDINGS), NOT the generic material refresh — Live keys are excluded from
// routeSignature(Refresh/Rebuild), so a fade tweak never forces a rebuild.
const BUILDINGS_FIELDS = {
  // ── Palette (HSL) — rebuild ──
  SATURATION_MIN: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 5,
    min: 0,
    max: 100,
    step: 5,
    label: 'Saturation min',
    tip: 'HSL saturation for the OLDEST (least-recently-modified) files — they tend toward this muted floor.',
  },
  SATURATION_MAX: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 100,
    min: 0,
    max: 100,
    step: 5,
    label: 'Saturation max',
    tip: 'HSL saturation for the NEWEST files — the richest version of the hue.',
  },
  LIGHTNESS_MIN: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 5,
    min: 0,
    max: 100,
    step: 5,
    label: 'Lightness min',
    tip: 'HSL lightness for stale files — dim, near-gray "rundown" look.',
  },
  LIGHTNESS_MAX: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 50,
    min: 0,
    max: 100,
    step: 5,
    label: 'Lightness max',
    tip: "HSL lightness for recently-modified files. Kept near 50 (HSL's peak-chroma point) so the hue stays saturated instead of washing toward white.",
  },
  HUE_EXT_MAP: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.HueMap,
    default: DEFAULT_HUE_EXT_MAP,
    label: 'Extension hues (0–359°)',
    tip: 'Hue per file extension, matched to the file icon color. Rebuild on change.',
  },

  // ── Outline — refresh ──
  OUTLINE_WIDTH: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Number,
    default: 4,
    min: 1,
    max: 10,
    step: 1,
    label: 'Linewidth',
    tip: 'Pixel thickness shared by per-building, hover, and selected outlines. Above 10 the wireframe occludes facade detail; below 1 it vanishes at typical zoom.',
  },
  OUTLINE_HOVER_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#ffffff',
    label: 'Hover color',
    tip: 'Outline color when the cursor is over a building.',
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
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Selected opacity',
    tip: 'Selected outline uses an animated rainbow color — see Effects > Rainbow.',
  },

  // ── Transition timing — live ──
  BUILDING_TRANSITION_MS: {
    route: ChangeRoute.Live,
    kind: FieldKind.Number,
    default: 500,
    min: 50,
    max: 3000,
    step: 10,
    label: 'Enter / refresh (ms)',
    tip: 'Fade-in / stay duration for buildings as they enter on initial render or refresh when the manifest changes. Above 3000ms tweens feel sluggish; below 50ms reads as a hard cut.',
  },

  // ── Facade geometry — shader-side (*_FRAC), refresh ──
  SLAB_HEIGHT_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.05,
    min: 0,
    max: 0.4,
    step: 0.01,
    label: 'Slab thickness × floor',
    tip: "Floor-slab strip height as a fraction of one floor. Above 0.4 the slab eats more than the floor's window band — the facade reads as horizontal banding instead of windowed.",
  },
  WINDOW_WIDTH_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Window width × cell',
    tip: 'Window width as a fraction of its grid cell.',
  },
  WINDOW_HEIGHT_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.45,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Window height × floor',
    tip: 'Window height as a fraction of one floor.',
  },
  WINDOW_MARGIN_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.08,
    min: 0,
    max: 0.2,
    step: 0.005,
    label: 'Window margin × face',
    tip: 'Horizontal margin per edge of the window grid, as a fraction of face width. Above 0.2 there is only room for ~3 window columns on a typical building.',
  },
  DOOR_HEIGHT_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.75,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Door height × floor',
    tip: 'Door height as a fraction of one floor.',
  },
  ROOF_BORDER_FRAC: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.05,
    min: 0,
    max: 0.1,
    step: 0.005,
    label: 'Roof border × face',
    tip: 'Width of the roof border strip, as a fraction of the face. Above 0.1 (10% of face width) the border eats into the icon area at the top of the facade.',
  },

  // ── Facade geometry — JS-side (baked attributes), rebuild ──
  WINDOW_COLS_MAX: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 1,
    max: 10,
    step: 1,
    label: 'Max window columns',
    tip: 'Hard cap on window columns per face. Rebuild required. Above 10 the window grid becomes too dense to read at typical zoom.',
  },
  WIDTH_PER_WINDOW_COL: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 12,
    min: 1,
    max: 32,
    step: 1,
    label: 'Width per window col',
    tip: 'World-unit width allotted per window column (cols = floor(buildingWidth / this)). Rebuild required. Above 32 world units per column, small buildings end up with zero windows.',
  },
  DOOR_WIDTH_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Door width',
    tip: "Door width as a fraction of the building's own width. Bigger buildings get proportionally wider doors. Rebuild required.",
  },

  // ── Facade contrast (HSL lightness Δ) — refresh ──
  SLAB_LIGHTNESS_DELTA: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: -10,
    min: -100,
    max: 100,
    step: 1,
    label: 'Floor slab',
    tip: 'Lightness offset for the floor-slab strip, in HSL percentage points (negative darkens).',
  },
  DOOR_LIGHTNESS_DELTA: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: -50,
    min: -100,
    max: 100,
    step: 1,
    label: 'Door',
    tip: 'Lightness offset for the door (negative darkens).',
  },
  ROOF_BORDER_LIGHTNESS_DELTA: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: -10,
    min: -100,
    max: 100,
    step: 1,
    label: 'Roof border',
    tip: 'Lightness offset for the roof border strip (negative darkens).',
  },

  // ── Window lighting — refresh ──
  UNLIT_LIGHTNESS_DELTA: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: -10,
    min: -20,
    max: 20,
    step: 1,
    label: 'Unlit pane lightness Δ',
    tip: 'HSL lightness offset applied to unlit panes (relative to the building hue).',
  },
  GAP_BASE_THRESHOLD: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Gap fraction (base)',
    tip: 'Base fraction of cells with no window at all (architectural gaps).',
  },
  GAP_AGE_BONUS: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    label: 'Gap fraction (age bonus)',
    tip: 'Extra empty-cell fraction added for the oldest building (interpolates down to 0 for the newest).',
  },
  LIT_FRESHNESS_EXPONENT: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 2.0,
    min: 1,
    max: 4,
    step: 0.1,
    label: 'Lit-window dim curve',
    tip: 'Exponent on the recency curve that drives lit-window count + HDR emission. 1 = linear; higher dims mid-age buildings faster so only the freshest ones glow. Beyond 4 only the newest ~6% of files visibly emit.',
  },
  DIM_GLOW_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#806626',
    label: 'Old building glow',
    tip: 'Warm-amber tint that lit panes drift toward as the file ages (created-date axis, not last-modified).',
  },
  WINDOW_EMISSION: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 3.0,
    step: 0.05,
    label: 'Emission (bloom)',
    tip: "Peak HDR push for the freshest building's lit windows; scales linearly down to 0 for the oldest. The bloom pass's strength × radius then operates on that age-scaled HDR signal, so total glow tracks building age. Gated on Effects > Bloom > Enabled. 0 = no bloom from windows; 1 = moderate; 3 = full neon.",
  },

  // ── Ad panels (media files) — rebuild (geometry baked at apply time) ──
  AD_SIDE_MARGIN_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.1,
    min: 0,
    max: 0.4,
    step: 0.01,
    label: 'Side margin × width',
    tip: 'Horizontal margin on each side of the building width — controls how much building wall is visible to the left and right of the ad. Above 0.4 the margins consume more than 80% of the face and the ad becomes a sliver.',
  },
  AD_BOTTOM_OFFSET_FLOORS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 3,
    step: 0.1,
    label: 'Bottom offset × floors',
    tip: 'Ad bottom edge sits this many floor heights above the ground — guarantees the door (0.75 of a floor tall) stays uncovered. 1.0 leaves a clean strip; raise it to lift the ad higher on the building.',
  },
  AD_PLACEHOLDER_COLOR: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Color,
    default: '#29293d',
    label: 'Placeholder color',
    tip: 'Color shown on the ad plane while the texture is loading (or if the load fails).',
  },
  AD_EMISSION: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.6,
    min: 0,
    max: 5.0,
    step: 0.1,
    label: 'Emission (bloom)',
    tip: 'Multiplier on ad panel colors. Bright pixels in the texture push past 1.0 and bloom; dark pixels stay below threshold. Gated on Effects > Bloom > Enabled. 0 = panel black; 1 = LDR (no bloom); higher = neon storefront.',
  },

  // ── Aging (createdAge-driven weathering) — refresh ──
  GRIME_ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'Vertical streaks of darker color falling from the top of each face on aged buildings. Off → clean facades regardless of age.',
  },
  GRIME_INTENSITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.RangePair,
    default: [0, 1] as [number, number],
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Intensity (new → old)',
    tip: 'How dark each streak gets, as a range across building age: left = newest buildings, right = oldest. 0 = invisible; 1 = strongly darkened wall color. Default 0 → 1 keeps new facades clean and fully weathers the oldest.',
  },
  GRIME_COVERAGE: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.RangePair,
    default: [0, 0.55] as [number, number],
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Coverage (new → old)',
    tip: 'Fraction of vertical bands that streak, as a range across age: left = newest buildings, right = oldest. Lower = sparser streaks; higher = nearly every band weathers.',
  },
  TILT_ENABLED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Enabled',
    tip: 'Small lean around the base, proportional to createdAge. Each building leans in a stable hashed direction. Off → all buildings stand perfectly upright.',
  },
  TILT_DEGREES: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.RangePair,
    default: [0, 1] as [number, number],
    min: 0,
    max: 10,
    step: 0.1,
    label: 'Lean degrees (new → old)',
    tip: 'Lean angle (degrees) as a range across age: left = newest buildings, right = oldest. Each building leans in a stable hashed direction. Above 10° buildings visually clip into their neighbors.',
  },

  // ── Selection-fade tiers — live ──
  // When something is selected, every other building is categorized by its
  // directory-tree distance from the selection and rendered per the matching
  // tier's style:
  //   DEFAULT — the selected/hovered building itself, and every building when
  //             nothing is selected (idle). On hover a building uses DEFAULT
  //             regardless of its tier — a "preview the selection" state.
  //   Level 1 — same dir as the selection (or the dir's direct files).
  //   Level 2 — one directory deeper than the selection.
  //   Level 3 — deeper descendants (two or more directories below).
  //   Level 4 — outside the selection's subtree entirely.
  // Each tier has four knobs: *_DETAIL (full | silhouette | hidden), *_OUTLINE
  // (wireframe on?), *_BODY_OPACITY, *_OUTLINE_OPACITY.
  DEFAULT_DETAIL: {
    route: ChangeRoute.Live,
    kind: FieldKind.Select,
    default: FadeDetail.Full,
    options: FADE_DETAIL_OPTIONS,
    label: 'Detail',
    tip: 'Full = textured walls + windows + doors. Silhouette = solid-color box. Hidden = body invisible (only outline can show).',
  },
  DEFAULT_OUTLINE: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: false,
    label: 'Outline',
    tip: 'Show the wireframe edge overlay.',
  },
  DEFAULT_BODY_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Body opacity',
    tip: 'Opacity for the body / silhouette layer.',
  },
  DEFAULT_OUTLINE_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Outline opacity',
    tip: 'Opacity for the wireframe outline layer (only visible if Outline is on).',
  },

  // Level 1 — same dir as the selection (or the dir's direct files).
  LEVEL1_DETAIL: {
    route: ChangeRoute.Live,
    kind: FieldKind.Select,
    default: FadeDetail.Full,
    options: FADE_DETAIL_OPTIONS,
    label: 'Detail',
  },
  LEVEL1_OUTLINE: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: false,
    label: 'Outline',
  },
  LEVEL1_BODY_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Body opacity',
  },
  LEVEL1_OUTLINE_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Outline opacity',
  },

  // Level 2 — one directory deeper than the selection.
  LEVEL2_DETAIL: {
    route: ChangeRoute.Live,
    kind: FieldKind.Select,
    default: FadeDetail.Silhouette,
    options: FADE_DETAIL_OPTIONS,
    label: 'Detail',
  },
  LEVEL2_OUTLINE: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Outline',
  },
  LEVEL2_BODY_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.75,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Body opacity',
  },
  LEVEL2_OUTLINE_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Outline opacity',
  },

  // Level 3 — deeper descendants (two or more directories below).
  LEVEL3_DETAIL: {
    route: ChangeRoute.Live,
    kind: FieldKind.Select,
    default: FadeDetail.Silhouette,
    options: FADE_DETAIL_OPTIONS,
    label: 'Detail',
  },
  LEVEL3_OUTLINE: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Outline',
  },
  LEVEL3_BODY_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Body opacity',
  },
  LEVEL3_OUTLINE_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Outline opacity',
  },

  // Level 4 — outside the selection's subtree entirely.
  LEVEL4_DETAIL: {
    route: ChangeRoute.Live,
    kind: FieldKind.Select,
    default: FadeDetail.Silhouette,
    options: FADE_DETAIL_OPTIONS,
    label: 'Detail',
  },
  LEVEL4_OUTLINE: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Outline',
  },
  LEVEL4_BODY_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Body opacity',
  },
  LEVEL4_OUTLINE_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Outline opacity',
  },
} satisfies FieldMap;

export const BUILDINGS = settingSignal('BUILDINGS', BUILDINGS_FIELDS);
export type BuildingsConfig = ConfigOf<typeof BUILDINGS_FIELDS>;
