// settings/fields/streets.ts — everything visual and layout-y about a
// street. Three stores, because the two the layout worker reads have to cross a
// thread boundary. Designer constants that were never controls are in
// city/constants/streets.ts.
import { FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '../schema';

// ─── Street surface + label + path-line visuals (one flat store) ───────────
// Prefixed keys, or COLOR and OPACITY collide. LABEL_* rebuilds, the rest refresh.
export const STREETS_FIELDS = {
  ASPHALT_COLOR: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.Color,
    default: '#313544',
    label: 'Color',
    tip: 'Color of the inner road stripe.',
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
    tip: 'Outline color of the label text, typically darker than the fill so it reads against any asphalt color.',
  },
  LABEL_STROKE_WIDTH_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.SliderField,
    default: 0.2,
    min: 0,
    max: 0.5,
    step: 0.01,
    label: 'Outline width',
    tip: 'Text outline thickness, as a fraction of the rendered character height. Above 0.5 the stroke overwhelms the glyph fill.',
  },
  LABEL_HEIGHT_FRAC: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.SliderField,
    default: 0.5,
    min: 0,
    max: 2,
    step: 0.05,
    label: 'Label size',
    tip: 'Label height as a fraction of the street width. Wider streets get bigger labels; above 2× the street width labels clip into adjacent rows.',
  },

  PATH_LINEWIDTH_PCT: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.SliderField,
    default: 15,
    min: 1,
    max: 50,
    step: 1,
    label: 'Line width %',
    tip: 'Shared thickness for both the rainbow selection line and the hover-preview line, as a % of the narrowest street tier width.',
  },
  PATH_OPACITY: {
    route: ChangeRoute.Refresh,
    kind: FieldKind.SliderField,
    default: 0.95,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Selection opacity',
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
    kind: FieldKind.SliderField,
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Hover preview opacity',
  },
} satisfies FieldMap;

export type StreetsConfig = ConfigOf<typeof STREETS_FIELDS>;

// ─── Street width tiers ────────────────────────────────────────────────────
// Descendant count → width, first tier winning. Its own store: the worker reads it.
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

export const STREET_TIERS_FIELDS = {
  TIERS: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.TierWidths,
    default: DEFAULT_STREET_TIERS,
    label: 'Street width tiers',
    tip: 'World-unit width per descendant-count tier. Wider streets read as more important directories from the air.',
  },
} satisfies FieldMap;

export type StreetTiersConfig = ConfigOf<typeof STREET_TIERS_FIELDS>;

// ─── Street layout / packing distances (world units) ──────────────────────
// All rebuild-routed; its own store because the layout worker reads it.
export const STREET_LAYOUT_FIELDS = {
  BUILDING_GAP: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    label: 'Building sibling gap',
    tip: 'Gap between two sibling buildings packed along a street. Lower is tighter blocks. A pair touching a side street uses Street sibling gap instead, if larger.',
  },
  STREET_GAP: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 32,
    min: 0,
    max: 50,
    step: 1,
    label: 'Street sibling gap',
    tip: 'Clearance on each side of a branching side street where it joins its parent. Raising it spaces out branches without widening building-to-building blocks.',
  },
  ROOT_END_PAD: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    label: 'Root end pad',
    tip: 'Fallback pad at each end of the root street, which has no parent intersection. Beyond ~50 world units streets balloon noticeably.',
  },
  PARENT_JOIN_PAD: {
    route: ChangeRoute.Rebuild,
    kind: FieldKind.Number,
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    label: 'Parent join pad',
    tip: 'Extra clear space where a child street meets its parent. Beyond ~50 world units streets balloon noticeably.',
  },
} satisfies FieldMap;

export type StreetLayoutConfig = ConfigOf<typeof STREET_LAYOUT_FIELDS>;
