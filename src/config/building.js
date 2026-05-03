// config/building.js — Everything visual about a building: dimensions,
// palette, facade rendering, outline, and selection-driven fade tiers.
//
// DIMENSIONS + PALETTE + FACADE changes are rebuild-required (regenerate
// per-building geometry / facade textures). OUTLINE + FADE are hot-reloadable.

import { map } from 'nanostores';

// ─── Dimensions ────────────────────────────────────────────────────────────
// Floors = sqrt-normalized across the project's own line-count range; width
// = log-normalized against SIZE_CEILING_BYTES.
export const BUILDING_DIMENSIONS = map({
  MIN_FLOORS:         1,
  MAX_FLOORS:         50,
  FLOOR_HEIGHT:       10,            // scene units per floor
  SIZE_CEILING_BYTES: 10485760,      // file size at which width caps at MAX_WIDTH
  MIN_WIDTH:          6,
  MAX_WIDTH:          40
});

// ─── Color palette (HSL) ───────────────────────────────────────────────────
// Hue comes from HUE_EXT_MAP keyed by file extension; saturation and
// lightness come from these ranges (older files are more muted, newer ones
// brighter). FALLBACK_COLOR / DIRECTORY_COLOR are used when a file has no
// extension match or for non-file (directory) buildings.
export const BUILDING_PALETTE = map({
  SATURATION_MIN: 20,
  SATURATION_MAX: 100,
  LIGHTNESS_MIN:  25,
  LIGHTNESS_MAX:  70,
  // Fallbacks when a file has no creation/modification date (rare but
  // possible). Kept in the middle of each range so the building still
  // reads as "average" rather than crushed to either extreme.
  SATURATION_MISSING_DATE_FALLBACK: 60,
  LIGHTNESS_MISSING_DATE_FALLBACK:  45,
  FALLBACK_COLOR:  'hsl(220, 10%, 40%)',   // when building.color is null
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

// ─── Color derivation (palette → wall / slab / window / door / roof) ──────
// Each building's base palette color is shaded into 7 derivatives drawn
// onto its facade texture. These are the multipliers / hue shifts that
// produce wall vs side vs slab vs window vs door from the same root color.
//   *_LIGHTNESS_DELTA — additive lightness shift (in HSL %, can be negative)
//   *_HUE_SHIFT       — hue rotation in degrees
//   *_DARKEN_RATIO    — multiplicative darkening (1.0 = unchanged, 0.5 = 50%)
//   *_LIGHTNESS_FLOOR — clamp floor so very dim files don't crush to black
export const BUILDING_SHADING = map({
  WALL_FRONT_LIGHTNESS_DELTA:  -5,
  WALL_FRONT_HUE_SHIFT:        18,
  WALL_SIDE_DARKEN_RATIO:      0.55,
  WALL_SIDE_LIGHTNESS_DELTA:   -10,
  WALL_SIDE_LIGHTNESS_FLOOR:   14,
  SLAB_FRONT_LIGHTNESS_DELTA:  -15,
  SLAB_FRONT_HUE_SHIFT:        18,
  SLAB_SIDE_DARKEN_RATIO:      0.40,
  SLAB_SIDE_LIGHTNESS_DELTA:   -10,
  SLAB_SIDE_LIGHTNESS_FLOOR:   10,
  WINDOW_LIGHTNESS_DELTA:      20,
  DOOR_LIGHTNESS_DELTA:        -55,
  ROOF_BORDER_LIGHTNESS_DELTA: -15
});

// ─── Facade rendering ──────────────────────────────────────────────────────
// Per-building facade is painted onto a CanvasTexture: walls, slab bands at
// each floor, a grid of windows, optionally a door on the ground floor.
// Rebuild-required (textures are baked once at scene build).
export const BUILDING_FACADE = map({
  TEXTURE_MIN_WIDTH_PX:        128,
  TEXTURE_WIDTH_PER_COL_MULT:  128,
  TEXTURE_MIN_HEIGHT_PX:       64,
  TEXTURE_HEIGHT_PER_FLOOR_MULT: 64,
  ANISOTROPY:                  8,
  SLAB_BAND_MIN_PX:            3,      // floor on slab pixel height for tiny textures
  SLAB_HEIGHT_FRAC:            0.12,   // slab band height = floor height × this
  WINDOW_MARGIN_FRAC:          0.08,
  WINDOW_WIDTH_FRAC:           0.45,
  WINDOW_HEIGHT_FRAC:          0.45,
  WINDOW_COLS_SIZE_DIVISOR:    8,
  WINDOW_COLS_MAX:             5,
  DOOR_WIDTH_FRAC:             0.14,
  DOOR_HEIGHT_FRAC:            0.7
});

// ─── Wireframe outlines ────────────────────────────────────────────────────
// Per-building outline stays invisible until the building fades; HOVER +
// SELECTED outlines are dedicated overlays painted over the active building.
// All hot-reloadable.
export const BUILDING_OUTLINE = map({
  DEFAULT_LINEWIDTH:    3,
  HOVER_COLOR:          '#ffffff',
  HOVER_LINEWIDTH:      2,
  HOVER_OPACITY:        0.85,
  SELECTED_LINEWIDTH:   4,
  SELECTED_OPACITY:     1.0,
  RAINBOW_SPEED:        0.00045,    // hue chase speed (multiplier on performance.now())
  RAINBOW_SATURATION:   1.0,
  RAINBOW_LIGHTNESS:    0.6
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
