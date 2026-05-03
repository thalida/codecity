// config/street.js — Everything visual about a street: asphalt, sidewalks,
// road labels, geometry. The asphalt color + sidewalk variants are
// hot-reloadable; label typography is rebuild-required (baked into
// CanvasTextures).

import { map, atom } from 'nanostores';

// ─── Asphalt (the inner stripe of every street) ────────────────────────────
// COLOR is hot-reloadable; WIDTH_FRAC + LENGTH_MIN_FRAC affect geometry and
// require a rebuild.
export const ASPHALT = map({
  COLOR:           '#1a1d28',
  WIDTH_FRAC:      0.6,        // asphalt width = street width × this
  LENGTH_MIN_FRAC: 0.2         // asphalt length floor = street length × this
});

// ─── Sidewalk tints ────────────────────────────────────────────────────────
// DEFAULT is the resting tint; HOVER / SELECTED / PATH are state-driven
// recolors (hover, current selection, ancestor lineage). All hot-reloadable.
export const SIDEWALK_COLORS = map({
  DEFAULT:  '#2c2e36',
  HOVER:    '#d0d2da',
  SELECTED: '#ffffff',
  PATH:     '#4a4c54'
});

// ─── Label typography ──────────────────────────────────────────────────────
// COLORS (FILL, STROKE) are hot-reloadable but the label TEXTURE is
// regenerated on change. SIZING / FONT changes are rebuild-required since
// the canvas dims depend on them.
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
  ANISOTROPY:        16,
  // Canvas text alignment used when painting the label texture.
  TEXT_ALIGN:        'center',
  TEXT_BASELINE:     'middle',
  // Y elevation (world units) of the label plane above the asphalt.
  // Tiny lift to avoid coplanar z-fighting with the road below.
  ELEVATION:         0.5
});

// ─── Stadium / pill geometry segments ──────────────────────────────────────
// Number of segments used to round the street's cap arcs. Higher = smoother
// rounded ends, lower = polygonal. Rebuild-required.
export const STREET_GEOMETRY = atom({ STADIUM_SEGMENTS: 16 });
