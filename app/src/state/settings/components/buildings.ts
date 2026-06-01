// state/settings/components/buildings.ts — Everything about a building:
// dimensions (own worker-threaded store), the BUILDINGS visual store (palette
// + outline + aging + transition timing), and the selection-fade tier matrix.
//
// Schema-driven (see state/settings/schema): each field states its own route.
// The big per-extension hue default lives in constants/buildings.ts.

import { persistedSignal } from '@/state/persist';
import { settingSignal, FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '@/state/settings/schema';
import { DEFAULT_HUE_EXT_MAP } from '@/constants/buildings';
import { FadeDetail } from '@/types';

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
  MIN_FLOORS: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 2, min: 1, max: 200, step: 1, label: 'Min floors',
    tip: "Floors for the smallest file in the project (fewest lines). Sqrt-interpolated up to Max across the project's line-count range." },
  MAX_FLOORS: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 64, min: 1, max: 200, step: 1, label: 'Max floors',
    tip: 'Floors for the largest file (most lines). Above ~200 the tallest buildings dwarf the city.' },
  FLOOR_HEIGHT: { route: ChangeRoute.Rebuild, kind: FieldKind.Number, default: 16, min: 1, max: 50, step: 1, label: 'Floor height',
    tip: 'Vertical world units per floor (multiplier on the floor count). Above 50 the floor-to-width aspect breaks readability.' },
  MIN_WIDTH: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 8, min: 1, max: 200, step: 1, label: 'Min width',
    tip: "Footprint width for the smallest file (fewest bytes). Log-interpolated up to Max across the project's byte-size range. Footprints are square (depth = width)." },
  MAX_WIDTH: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 96, min: 1, max: 200, step: 1, label: 'Max width',
    tip: 'Footprint width for the largest file (most bytes).' },
  DISTANCE_FROM_ROAD: { route: ChangeRoute.Rebuild, kind: FieldKind.Number, default: 8, min: 0, max: 50, step: 1, label: 'Distance from road',
    tip: 'Gap between the building wall and the street edge. Same for every building.' },
} satisfies FieldMap;

export const BUILDING_DIMENSIONS = settingSignal('BUILDING_DIMENSIONS', BUILDING_DIMENSIONS_FIELDS);
export type BuildingDimensionsConfig = ConfigOf<typeof BUILDING_DIMENSIONS_FIELDS>;

// ─── Buildings visual store (palette + outline + aging + transition) ────────
// One flat store for the per-building visual knobs that paint on top of the
// (separate, worker-threaded) dimensions. Sub-features are key-prefixed:
//   SATURATION_/LIGHTNESS_/HUE_EXT_MAP — HSL palette (rebuild: bakes into
//     per-building facade textures via buildingColor).
//   OUTLINE_*                          — wireframe outline (refresh: applyTheme
//     → outlineRenderer / shared material uniform).
//   GRIME_/TILT_                       — age-driven decay (refresh:
//     refreshBuildingMaterial uniforms).
//   BUILDING_TRANSITION_MS             — enter/stay tween length (live: the
//     animator reads it fresh per transition, no reaction).
//
// Saturation/lightness MIN/MAX stay separate scalar keys (read independently
// by buildingColor), same rationale as dimensions.
const BUILDINGS_FIELDS = {
  // ── Palette (HSL) — rebuild ──
  SATURATION_MIN: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 5, min: 0, max: 100, step: 5, label: 'Saturation min',
    tip: 'HSL saturation for the OLDEST (least-recently-modified) files — they tend toward this muted floor.' },
  SATURATION_MAX: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 100, min: 0, max: 100, step: 5, label: 'Saturation max',
    tip: 'HSL saturation for the NEWEST files — the richest version of the hue.' },
  LIGHTNESS_MIN: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 5, min: 0, max: 100, step: 5, label: 'Lightness min',
    tip: 'HSL lightness for stale files — dim, near-gray "rundown" look.' },
  LIGHTNESS_MAX: { route: ChangeRoute.Rebuild, kind: FieldKind.Slider, default: 50, min: 0, max: 100, step: 5, label: 'Lightness max',
    tip: "HSL lightness for recently-modified files. Kept near 50 (HSL's peak-chroma point) so the hue stays saturated instead of washing toward white." },
  HUE_EXT_MAP: { route: ChangeRoute.Rebuild, kind: FieldKind.HueMap, default: DEFAULT_HUE_EXT_MAP, label: 'Extension hues (0–359°)',
    tip: 'Hue per file extension, matched to the file icon color. Rebuild on change.' },

  // ── Outline — refresh ──
  OUTLINE_WIDTH: { route: ChangeRoute.Refresh, kind: FieldKind.Number, default: 4, min: 1, max: 10, step: 1, label: 'Linewidth',
    tip: 'Pixel thickness shared by per-building, hover, and selected outlines. Above 10 the wireframe occludes facade detail; below 1 it vanishes at typical zoom.' },
  OUTLINE_HOVER_COLOR: { route: ChangeRoute.Refresh, kind: FieldKind.Color, default: '#ffffff', label: 'Hover color',
    tip: 'Outline color when the cursor is over a building.' },
  OUTLINE_HOVER_OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.5, min: 0, max: 1, step: 0.05, label: 'Hover opacity' },
  OUTLINE_SELECTED_OPACITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 1.0, min: 0, max: 1, step: 0.05, label: 'Selected opacity',
    tip: 'Selected outline uses an animated rainbow color — see Effects > Rainbow.' },

  // ── Aging — refresh ──
  GRIME_ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Enabled',
    tip: 'Vertical streaks of darker color falling from the top of each face on aged buildings. Off → clean facades regardless of age.' },
  GRIME_INTENSITY: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.75, min: 0, max: 1, step: 0.05, label: 'Intensity',
    tip: 'How dark each streak gets. 0 = invisible; 1 = strongly darkened wall color.' },
  GRIME_COVERAGE: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 0.55, min: 0, max: 1, step: 0.05, label: 'Coverage',
    tip: 'Fraction of vertical bands the oldest building shows as streaky. Lower = sparser streaks; higher = nearly every band weathers.' },
  TILT_ENABLED: { route: ChangeRoute.Refresh, kind: FieldKind.Toggle, default: true, label: 'Enabled',
    tip: 'Small lean around the base, proportional to createdAge. Each building leans in a stable hashed direction. Off → all buildings stand perfectly upright.' },
  TILT_DEGREES: { route: ChangeRoute.Refresh, kind: FieldKind.Slider, default: 1, min: 0, max: 10, step: 0.1, label: 'Max degrees',
    tip: 'Maximum lean angle (degrees) applied to the oldest building. Newer buildings interpolate down to 0. Above 10° buildings visually clip into their neighbors.' },

  // ── Transition timing — live ──
  BUILDING_TRANSITION_MS: { route: ChangeRoute.Live, kind: FieldKind.Number, default: 375, min: 50, max: 3000, step: 10, label: 'Enter / refresh (ms)',
    tip: 'Fade-in / stay duration for buildings as they enter on initial render or refresh when the manifest changes. Above 3000ms tweens feel sluggish; below 50ms reads as a hard cut.' },
} satisfies FieldMap;

export const BUILDINGS = settingSignal('BUILDINGS', BUILDINGS_FIELDS);
export type BuildingsConfig = ConfigOf<typeof BUILDINGS_FIELDS>;

// ─── Visibility / selection-driven fade ────────────────────────────────────
// When something is selected, every other building is categorized by its
// directory-tree distance from the selection and rendered per the matching
// tier's style:
//   DEFAULT — applies to the selected/hovered building itself and to every
//             building when nothing is selected (idle state).
//   Level 1 — same dir as the selection (or the dir's direct files).
//   Level 2 — one directory deeper than the selection.
//   Level 3 — deeper descendants (two or more directories below).
//   Level 4 — outside the selection's subtree entirely.
//
// Each tier picks how a building looks via four independent knobs:
//   *_DETAIL          — 'full' (textured walls + windows + doors)
//                     | 'silhouette' (solid-color box, no windows)
//                     | 'hidden' (the body and ghost are both gone)
//   *_OUTLINE         — boolean. Whether the wireframe edges layer is on.
//   *_BODY_OPACITY    — opacity multiplier for the body / silhouette layer.
//   *_OUTLINE_OPACITY — opacity multiplier for the wireframe layer.
//
// On hover, a building is rendered using the DEFAULT tier's settings
// (full detail, default body + outline opacity) regardless of which tier
// it would otherwise sit in — hover acts as a "preview the selection" state.
//
// All applied on Save via applyTheme().
export interface BuildingFadeConfig {
  DEFAULT_DETAIL: FadeDetail;
  DEFAULT_OUTLINE: boolean;
  DEFAULT_BODY_OPACITY: number;
  DEFAULT_OUTLINE_OPACITY: number;
  LEVEL1_DETAIL: FadeDetail;
  LEVEL1_OUTLINE: boolean;
  LEVEL1_BODY_OPACITY: number;
  LEVEL1_OUTLINE_OPACITY: number;
  LEVEL2_DETAIL: FadeDetail;
  LEVEL2_OUTLINE: boolean;
  LEVEL2_BODY_OPACITY: number;
  LEVEL2_OUTLINE_OPACITY: number;
  LEVEL3_DETAIL: FadeDetail;
  LEVEL3_OUTLINE: boolean;
  LEVEL3_BODY_OPACITY: number;
  LEVEL3_OUTLINE_OPACITY: number;
  LEVEL4_DETAIL: FadeDetail;
  LEVEL4_OUTLINE: boolean;
  LEVEL4_BODY_OPACITY: number;
  LEVEL4_OUTLINE_OPACITY: number;
}

export const BUILDING_FADE = persistedSignal<BuildingFadeConfig>('BUILDING_FADE', {
  // Default tier — applies to the selected/hovered building itself
  // and to every building when nothing is selected (idle state).
  DEFAULT_DETAIL: FadeDetail.Full,
  DEFAULT_OUTLINE: false,
  DEFAULT_BODY_OPACITY: 1.0,
  DEFAULT_OUTLINE_OPACITY: 1.0,

  // Level 1 — same dir as the selection (or the dir's direct files).
  LEVEL1_DETAIL: FadeDetail.Full,
  LEVEL1_OUTLINE: false,
  LEVEL1_BODY_OPACITY: 1.0,
  LEVEL1_OUTLINE_OPACITY: 1.0,

  // Level 2 — one directory deeper than the selection.
  LEVEL2_DETAIL: FadeDetail.Silhouette,
  LEVEL2_OUTLINE: true,
  LEVEL2_BODY_OPACITY: 0.75,
  LEVEL2_OUTLINE_OPACITY: 0.5,

  // Level 3 — deeper descendants (two or more directories below).
  LEVEL3_DETAIL: FadeDetail.Silhouette,
  LEVEL3_OUTLINE: true,
  LEVEL3_BODY_OPACITY: 0.25,
  LEVEL3_OUTLINE_OPACITY: 0.5,

  // Level 4 — outside the selection's subtree entirely.
  LEVEL4_DETAIL: FadeDetail.Silhouette,
  LEVEL4_OUTLINE: true,
  LEVEL4_BODY_OPACITY: 0.05,
  LEVEL4_OUTLINE_OPACITY: 0.5,
});
