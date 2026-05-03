// config/building.js — Everything visual about a building: dimensions,
// palette, outline, and selection-driven fade tiers.
//
// DIMENSIONS + PALETTE changes are rebuild-required (regenerate per-building
// geometry / facade textures). OUTLINE + FADE are hot-reloadable.

import { map } from 'nanostores';

// ─── Dimensions ────────────────────────────────────────────────────────────
// Floors and width are BOTH normalized against the project's own range:
// smallest file → MIN, largest → MAX. Floors uses sqrt-interpolation across
// line counts, width uses log-interpolation across byte sizes (file sizes
// span many orders of magnitude). Both auto-adapt per project — no absolute
// "size ceiling" anchor that punishes small repos with thin buildings or
// crushes large repos to all-the-same width.
//
// STREET_GAP is the empty space a building leaves around itself toward the
// adjacent sidewalk. The path connector strip's length AND width are both
// derived from this — the strip is square, exactly bridging the gap.
export const BUILDING_DIMENSIONS = map({
  MIN_FLOORS:   1,
  MAX_FLOORS:   50,
  FLOOR_HEIGHT: 10,           // scene units per floor
  MIN_WIDTH:    6,
  MAX_WIDTH:    40,
  STREET_GAP:   4             // gap between building wall and adjacent sidewalk
});

// ─── Color palette (HSL) ───────────────────────────────────────────────────
// Hue comes from HUE_EXT_MAP keyed by file extension; saturation and
// lightness come from these ranges (older files are more muted, newer ones
// brighter). DIRECTORY_COLOR is used for directory buildings.
export const BUILDING_PALETTE = map({
  SATURATION_MIN:   20,
  SATURATION_MAX:   100,
  LIGHTNESS_MIN:    25,
  LIGHTNESS_MAX:    70,
  // (When a file has no creation/modification date, getSaturation /
  // getLightness fall back to the midpoint of the range above so the
  // building reads as "average" rather than crushed to either extreme.)
  DIRECTORY_COLOR: 'hsl(220, 15%, 25%)',   // dim slab for directory entries
  HUE_EXT_MAP: {
    '.js':   220, '.ts':   215, '.jsx':   225, '.tsx': 210, '.mjs': 220,
    '.py':   15,  '.pyx':  20,  '.pyi':   10,
    '.css':  150, '.scss': 145, '.less':  155, '.sass': 148,
    '.html': 175, '.vue':  170, '.svelte': 180,
    '.json': 50,  '.yaml': 55,  '.toml':  45,  '.ini': 52,
    '.md':   275, '.txt':  280, '.rst':   270,
    '.sh':   35,  '.bash': 38,  '.zsh':   32,
    '.go':   185, '.rs':   5
  }
});

// ─── Wireframe outlines ────────────────────────────────────────────────────
// Per-building outline stays invisible until the building fades; HOVER +
// SELECTED outlines are dedicated overlays painted over the active building.
// One shared WIDTH for all three outlines — hover/selected differentiate
// via color (white for hover, animated rainbow for selected) rather than
// thickness. The chasing-rainbow effect on selected uses RAINBOW (shared
// with the path line) — see config/effects.js.
export const BUILDING_OUTLINE = map({
  WIDTH:            3,            // shared by default + hover + selected
  HOVER_COLOR:      '#ffffff',
  HOVER_OPACITY:    0.85,
  SELECTED_OPACITY: 1.0
});

// ─── Visibility / selection-driven fade ────────────────────────────────────
// When a street/building is selected or hovered, every other building gets
// dimmed based on its directory-tree distance from the selection. All
// hot-reloadable.
export const BUILDING_FADE = map({
  LERP_SPEED:        0.18,    // per-frame easing toward target opacity
  SNAP_THRESHOLD:    0.005,   // close-enough threshold to stop lerping
  // Material.opacity above this counts as opaque (depthWrite on, full
  // alpha). Just below 1.0 so any faded tier flips to true transparency.
  OPAQUE_THRESHOLD:  0.999,
  // Crossfade band between textured (windowed) mesh and windowless ghost.
  // FADE_BOTTOM must stay above TIER_NEAR_BODY so faded tiers never reveal
  // windows.
  FADE_TOP:          1.0,
  FADE_BOTTOM:       0.7,
  // Tier values for "1 hop along the selection's spine".
  TIER_NEAR_BODY:    0.65,
  TIER_NEAR_OUTLINE: 0.40,
  TIER_NEAR_GHOST:   0.85,
  // Tier values for everything farther than 1 hop (outline-only "distant").
  TIER_FAR_BODY:     0.18,
  TIER_FAR_OUTLINE:  0.12,
  TIER_FAR_GHOST:    0.20,
  // A hovered file building never fades below this opacity even if it sits
  // in the FAR tier.
  HOVER_MIN_OPACITY: 0.7
});
