// state/stores/settings/streets.ts — Everything visual + layout-y about a
// street: asphalt, sidewalks, road labels, and the two route-highlight path
// lines (STREETS, schema-driven), plus how streets are sized + packed
// (STREET_TIERS + STREET_LAYOUT, worker-threaded object stores).
//
// Asphalt + sidewalk + path-line fields are material-refresh;
// the label fields are rebuild-required (label textures bake at build time).
// Each field states its own route — settingsReactions.ts derives its rebuild/refresh
// signatures from that metadata (see state/schema).
//
// Designer constants that were never UI controls (asphalt width fraction,
// label font/elevation, path-line elevations) live in constants/streets.ts.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

// ─── Street surface + label + path-line visuals (one flat store) ───────────
// Keys are prefixed by sub-feature (ASPHALT_ / SIDEWALK_ / LABEL_ / PATH_ /
// HOVER_PATH_) so the flat map stays unambiguous where names would collide
// (COLOR, OPACITY, …). The route differs per group: LABEL_* rebuilds (the
// label canvas dims depend on them); everything else refreshes.
const STREETS_FIELDS = {
  ASPHALT_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#313544',
    label: 'Color',
    tip: 'Color of the inner road stripe. Live.',
  },

  SIDEWALK_DEFAULT: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#4b5163',
    label: 'Default',
    tip: 'Resting tint on every sidewalk.',
  },
  SIDEWALK_HOVER: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#6d6e74',
    label: 'Hover',
    tip: 'When the cursor is over a street.',
  },
  SIDEWALK_SELECTED: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#ffffff',
    label: 'Selected',
    tip: 'When a street (directory) is selected.',
  },

  LABEL_FILL: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Color,
    default: '#ffffff',
    label: 'Text color',
    tip: 'Text color of the names painted on each road.',
  },
  LABEL_STROKE: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Color,
    default: 'rgba(8, 9, 14, 0.95)',
    label: 'Outline color',
    tip: 'Outline color of the label text — typically darker than the fill so the label reads against any asphalt color.',
  },
  LABEL_STROKE_WIDTH_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.2,
    min: 0,
    max: 0.5,
    step: 0.01,
    label: 'Outline width',
    tip: 'Text outline thickness, as a fraction of the rendered character height. Above 0.5 the stroke overwhelms the glyph fill.',
  },
  LABEL_HEIGHT_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0,
    max: 2,
    step: 0.05,
    label: 'Label size',
    tip: 'Label height as a fraction of the street width. Wider streets get bigger labels. Above 2× the street width labels clip into adjacent rows.',
  },

  PATH_LINEWIDTH_PCT: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 15,
    min: 1,
    max: 50,
    step: 1,
    label: 'Line width %',
    tip: 'Shared thickness for both the rainbow selection line and the hover-preview line, as a % of the narrowest street tier width.',
  },
  PATH_OPACITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.95,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Selection opacity',
    tip: 'Selection-line transparency. 0 = invisible; 1 = solid.',
  },
  HOVER_PATH_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#ffffff',
    label: 'Hover preview color',
    tip: 'Solid color of the hover-preview line. Faded white by default so it reads as a draft, not the committed selection.',
  },
  HOVER_PATH_OPACITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Slider,
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Hover preview opacity',
    tip: 'Hover-preview transparency. 0 = invisible; 1 = solid.',
  },
} satisfies FieldMap;

export const STREETS = settingSignal('STREETS', STREETS_FIELDS);
export type StreetsConfig = ConfigOf<typeof STREETS_FIELDS>;

// ─── Street width tiers ────────────────────────────────────────────────────
// Step-function mapping a directory's descendant count to its street width.
// The first matching tier from the top wins. Wider streets read as more
// important directories from the air. Worker-threaded (the layout worker reads
// it), so it stays its own object store; the ordered array lives under the
// single TIERS field (FieldKind.TierWidths renders one width slider per tier).
export interface StreetTier {
  min_descendants: number;
  width: number;
}

const DEFAULT_STREET_TIERS: StreetTier[] = [
  { min_descendants: 0, width: 32 },
  { min_descendants: 4, width: 48 },
  { min_descendants: 8, width: 80 },
  { min_descendants: 16, width: 96 },
  { min_descendants: 32, width: 128 },
];

const STREET_TIERS_FIELDS = {
  TIERS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.TierWidths,
    default: DEFAULT_STREET_TIERS,
    label: 'Street width tiers',
    tip: 'World-unit width per descendant-count tier. Wider streets read as more important directories from the air. Rebuild on change.',
  },
} satisfies FieldMap;

export const STREET_TIERS = settingSignal('STREET_TIERS', STREET_TIERS_FIELDS);
export type StreetTiersConfig = ConfigOf<typeof STREET_TIERS_FIELDS>;

// ─── Street layout / packing distances (world units) ──────────────────────
// How buildings + child streets are packed along their parent street. All
// rebuild-required (changing any of these reshapes the entire layout), and
// worker-threaded (the layout worker reads them) so it stays its own store.
const STREET_LAYOUT_FIELDS = {
  BUILDING_GAP: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    label: 'Building sibling gap',
    tip: 'Gap between two sibling buildings packed along a street. Lower = tighter blocks. The clearance around a branching side street uses Street sibling gap instead, so a pair touching a side street takes the larger of the two.',
  },
  STREET_GAP: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 32,
    min: 0,
    max: 50,
    step: 1,
    label: 'Street sibling gap',
    tip: 'Clearance on each side of a branching side street where it joins its parent. Applies to any sibling pair where at least one is a side street, so raising it spaces out branches without widening building-to-building blocks.',
  },
  ROOT_END_PAD: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    label: 'Root end pad',
    tip: 'Fallback pad at each end of the root street (which has no parent intersection). 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably.',
  },
  PARENT_JOIN_PAD: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    label: 'Parent join pad',
    tip: 'Extra clear space where a child street meets its parent. 50 world units is roughly two MAX_WIDTH building footprints — beyond this streets balloon noticeably.',
  },
} satisfies FieldMap;

export const STREET_LAYOUT = settingSignal('STREET_LAYOUT', STREET_LAYOUT_FIELDS);
export type StreetLayoutConfig = ConfigOf<typeof STREET_LAYOUT_FIELDS>;
