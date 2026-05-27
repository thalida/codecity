// config/street.js — Everything visual + layout-y about a street: asphalt,
// sidewalks, road labels, the neon path line, and how streets are sized +
// packed (tiers + gaps). Asphalt color + sidewalk variants are applied on Save
// via applyTheme(); label typography + tiers + gaps are rebuild-required.

import { atom, map } from 'nanostores';

// ─── Asphalt (the inner stripe of every street) ──────────────────────────
// COLOR is applied on Save via applyTheme(). Width and length are derived: width = street
// width × WIDTH_FRAC; length is whatever keeps the asphalt cap circle
// concentric with the sidewalk cap circle (length - 2 × sidewalkStrip).
// Both are designer constants — not surfaced as UI controls because they
// shape geometry and the user should never break concentric caps.
export interface AsphaltConfig {
  COLOR: string;
  WIDTH_FRAC: number;
}

export const ASPHALT = map<AsphaltConfig>({
  COLOR: '#313544',
  WIDTH_FRAC: 0.6,
});

// ─── Sidewalk tints ────────────────────────────────────────────────────────
// DEFAULT is the resting tint; HOVER / SELECTED are state-driven recolors
// (cursor, current selection). All applied on Save via applyTheme(). Lineage from the root
// gem to the current selection is shown only by the neon path line — no
// sidewalk recolor for path streets.
export interface SidewalkColorsConfig {
  DEFAULT: string;
  HOVER: string;
  SELECTED: string;
}

export const SIDEWALK_COLORS = map<SidewalkColorsConfig>({
  DEFAULT: '#4b5163',
  HOVER: '#6d6e74',
  SELECTED: '#ffffff',
});

// ─── Street label typography ──────────────────────────────────────────────
// Names painted along each road. COLORS (FILL, STROKE) are applied on Save
// via applyTheme() but the label TEXTURE is regenerated on change. SIZING / FONT changes
// are rebuild-required since the canvas dims depend on them.
//   MIN_SCALE caps how aggressively a too-long label can be shrunk to fit
//   its street before we fall back to truncating with an ellipsis.
export interface LabelTypographyConfig {
  FILL: string;
  STROKE: string;
  FONT_FAMILY: string;
  FONT_WEIGHT: number;
  FONT_SIZE_PX: number;
  CANVAS_PADDING_FRAC: number; // padding around glyphs as fraction of FONT_SIZE_PX (default 0.25 = 48px at 192px font)
  STROKE_WIDTH_FRAC: number; // outline stroke width as fraction of FONT_SIZE_PX (default 1/6 ≈ 32px at 192px font)
  HEIGHT_FRAC: number;
  MIN_SCALE: number;
  SPACING_MULT: number;
  SPACING_FLOOR: number;
  ELEVATION: number;
}

export const LABEL_TYPOGRAPHY = map<LabelTypographyConfig>({
  FILL: '#ffffff',
  STROKE: 'rgba(8, 9, 14, 0.95)',
  FONT_FAMILY: 'Inter, "SF Mono", sans-serif',
  FONT_WEIGHT: 700,
  FONT_SIZE_PX: 192,
  CANVAS_PADDING_FRAC: 0.25,
  STROKE_WIDTH_FRAC: 0.2,
  HEIGHT_FRAC: 0.5, // label plane height = street width × this
  MIN_SCALE: 0.5, // floor for fit-shrink (fraction of natural height); below this, truncate with …
  SPACING_MULT: 8.0, // repeat spacing = label width × this
  SPACING_FLOOR: 256, // …or this floor (world units), whichever is larger
  ELEVATION: 0, // lift above asphalt (rarely tweaked; not in UI)
});

// ─── Neon path line (gem → selection) ──────────────────────────────────────
// Tracing the lineage from the root gem through each parent street to the
// current selection. Rainbow color cycle is shared with the selected building
// outline — see RAINBOW in config/effects.js.
export interface PathLineConfig {
  LINEWIDTH: number;
  ELEVATION: number;
  OPACITY: number;
}

export const PATH_LINE = map<PathLineConfig>({
  LINEWIDTH: 8,
  ELEVATION: 0.3, // Y position above ground
  OPACITY: 0.95,
});

// ─── Hover preview path line (gem → hovered target) ───────────────────────
// A draft / "what would happen if I clicked here" version of PATH_LINE,
// drawn while the cursor is over a hovered building or street. Solid
// color (not rainbow) and faded so it reads as a preview, not the
// committed selection. Suppressed when hover matches the current
// selection (would just overlap the rainbow line).
export interface HoverPathLineConfig {
  ENABLED: boolean;
  LINEWIDTH: number;
  COLOR: string;
  OPACITY: number;
  ELEVATION: number;
}

export const HOVER_PATH_LINE = map<HoverPathLineConfig>({
  ENABLED: true,
  LINEWIDTH: 8,
  COLOR: '#ffffff',
  OPACITY: 0.25,
  ELEVATION: 0.25, // sits just below PATH_LINE so the rainbow stays on top
});

// ─── Street width tiers ────────────────────────────────────────────────────
// Step-function mapping a directory's descendant count to its street width.
// The first matching tier from the top wins. Wider streets read as more
// important directories from the air. Stored as an atom because it's an
// ordered array, not a key/value map.
export interface StreetTier {
  min_descendants: number;
  width: number;
}

export const STREET_TIERS = atom<StreetTier[]>([
  { min_descendants: 0, width: 32 },
  { min_descendants: 4, width: 48 },
  { min_descendants: 8, width: 80 },
  { min_descendants: 16, width: 96 },
  { min_descendants: 32, width: 128 },
]);

// ─── Street layout / packing distances (world units) ──────────────────────
// How buildings + child streets are packed along their parent street.
//   CHILD_GAP        — between sibling children (file or subdir) on a street
//   ROOT_END_PAD     — fallback pad at each end of the root street (which
//                      has no parent intersection to size against)
//   PARENT_JOIN_PAD  — extra clear space where a child street meets its parent
// All rebuild-required (changing any of these reshapes the entire layout).
export interface StreetLayoutConfig {
  CHILD_GAP: number;
  ROOT_END_PAD: number;
  PARENT_JOIN_PAD: number;
}

export const STREET_LAYOUT = map<StreetLayoutConfig>({
  CHILD_GAP: 8,
  ROOT_END_PAD: 8,
  PARENT_JOIN_PAD: 8,
});
