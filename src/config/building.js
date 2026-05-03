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
// When something is selected, every other building is categorized by its
// directory-tree distance from the selection and rendered per the matching
// tier's style:
//   DEFAULT — distance 0 (selection's siblings; also the no-selection state)
//   NEAR    — distance 1 (one hop along the directory spine)
//   FAR     — distance ≥2 (cousins, deeper subtrees, unrelated branches)
//
// Each tier picks how a building looks via three independent knobs:
//   *_DETAIL  — 'full' (textured with windows + doors)
//             | 'silhouette' (solid-color box, no windows)
//             | 'hidden'  (the body and ghost are both gone)
//   *_OUTLINE — boolean. The wireframe edges layer.
//   *_OPACITY — overall multiplier on whatever layers are visible.
//
// All hot-reloadable.
export const BUILDING_FADE = map({
  // Animation
  LERP_SPEED:        0.18,
  SNAP_THRESHOLD:    0.005,

  // Default tier — siblings of selection, and the no-selection resting state.
  DEFAULT_DETAIL:  'full',
  DEFAULT_OUTLINE: false,
  DEFAULT_OPACITY: 1.0,

  // Level 1 — one hop from selection along the directory spine.
  NEAR_DETAIL:  'full',
  NEAR_OUTLINE: true,
  NEAR_OPACITY: 0.65,

  // Level 2+ — anything farther.
  FAR_DETAIL:  'silhouette',
  FAR_OUTLINE: true,
  FAR_OPACITY: 0.18,

  // A hovered file building's body never drops below this opacity even when
  // it sits in the FAR tier — keeps the hover preview readable.
  HOVER_MIN_OPACITY: 0.7
});
