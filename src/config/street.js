// config/street.js — Everything visual + layout-y about a street: asphalt,
// sidewalks, road labels, the neon path line, and how streets are sized +
// packed (tiers + gaps). Asphalt color + sidewalk variants are hot-reloadable;
// label typography + tiers + gaps are rebuild-required.

import { atom, map } from 'nanostores';

// ─── Asphalt (the inner stripe of every street) ──────────────────────────
// COLOR is hot-reloadable. Width and length are derived: width = street
// width × WIDTH_FRAC; length is whatever keeps the asphalt cap circle
// concentric with the sidewalk cap circle (length - 2 × sidewalkStrip).
// Both are designer constants — not surfaced as UI controls because they
// shape geometry and the user should never break concentric caps.
export const ASPHALT = map({
  COLOR:      '#1a1d28',
  WIDTH_FRAC: 0.6
});

// ─── Sidewalk tints ────────────────────────────────────────────────────────
// DEFAULT is the resting tint; HOVER / SELECTED are state-driven recolors
// (cursor, current selection). All hot-reloadable. Lineage from the root
// gem to the current selection is shown only by the neon path line — no
// sidewalk recolor for path streets.
export const SIDEWALK_COLORS = map({
  DEFAULT:  '#2c2e36',
  HOVER:    '#d0d2da',
  SELECTED: '#ffffff'
});

// ─── Street label typography ──────────────────────────────────────────────
// Names painted along each road. COLORS (FILL, STROKE) are hot-reloadable
// but the label TEXTURE is regenerated on change. SIZING / FONT changes
// are rebuild-required since the canvas dims depend on them.
//   FLIP_HYSTERESIS is hot-reloadable: it's the camera-orbit dead zone
//   before labels rotate 180° to stay readable.
export const LABEL_TYPOGRAPHY = map({
  FILL:              '#f4f6ff',
  STROKE:            'rgba(8, 9, 14, 0.95)',
  FONT_FAMILY:       'Inter, "SF Mono", sans-serif',
  FONT_WEIGHT:       700,
  FONT_SIZE_PX:      192,
  CANVAS_PADDING_PX: 48,
  STROKE_WIDTH_PX:   32,
  HEIGHT_FRAC:       0.45,     // label plane height = street width × this
  SPACING_MULT:      3.5,      // repeat spacing = label width × this
  SPACING_FLOOR:     200,      // …or this floor (world units), whichever is larger
  ELEVATION:         0.5,      // lift above asphalt to avoid z-fighting
  FLIP_HYSTERESIS:   0.15      // dead zone before camera-orbit flip
});

// ─── Neon path line (gem → selection) ──────────────────────────────────────
// Tracing the lineage from the root gem through each parent street to the
// current selection. Rainbow color cycle is shared with the selected building
// outline — see RAINBOW in config/effects.js.
export const PATH_LINE = map({
  LINEWIDTH: 5,
  ELEVATION: 0.3,    // Y position above ground
  OPACITY:   0.95
});

// ─── Street width tiers ────────────────────────────────────────────────────
// Step-function mapping a directory's descendant count to its street width.
// The first matching tier from the top wins. Wider streets read as more
// important directories from the air. Stored as an atom because it's an
// ordered array, not a key/value map.
export const STREET_TIERS = atom([
  { min_descendants: 0,  width: 10 },
  { min_descendants: 4,  width: 16 },
  { min_descendants: 9,  width: 24 },
  { min_descendants: 16, width: 36 },
  { min_descendants: 31, width: 52 }
]);

// ─── Street layout / packing distances (world units) ──────────────────────
// How buildings + child streets are packed along their parent street.
//   CHILD_GAP        — between sibling children (file or subdir) on a street
//   ROOT_END_PAD     — fallback pad at each end of the root street (which
//                      has no parent intersection to size against)
//   PARENT_JOIN_PAD  — extra clear space where a child street meets its parent
// All rebuild-required (changing any of these reshapes the entire layout).
export const STREET_LAYOUT = map({
  CHILD_GAP:       5,
  ROOT_END_PAD:    8,
  PARENT_JOIN_PAD: 3
});
