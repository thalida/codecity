// config/building.js — Everything visual about a building: dimensions,
// palette, outline, and selection-driven fade tiers.
//
// DIMENSIONS + PALETTE changes are rebuild-required (regenerate per-building
// geometry / facade textures). OUTLINE + FADE are hot-reloadable.

import { map } from 'nanostores';
import { FadeDetail } from '@/types';

// ─── Dimensions ────────────────────────────────────────────────────────────
// Floors and width are BOTH normalized against the project's own range:
// smallest file → MIN, largest → MAX. Floors uses sqrt-interpolation across
// line counts, width uses log-interpolation across byte sizes (file sizes
// span many orders of magnitude). Both auto-adapt per project — no absolute
// "size ceiling" anchor that punishes small repos with thin buildings or
// crushes large repos to all-the-same width.
//
// PATH_LENGTH is the gap perpendicular to the street (between the building
// wall and the adjacent sidewalk) — an absolute world distance shared by
// every building. PATH_WIDTH_FRAC is a per-building fraction of that
// building's own width: a 40-unit building with frac 0.4 gets a 16-unit-
// wide path, while a 6-unit building gets a 2.4-unit path. The door is
// sized off the same per-building path width so "walk out the door, onto
// the path" reads visually no matter how big the building is.
export interface BuildingDimensionsConfig {
  MIN_FLOORS: number;
  MAX_FLOORS: number;
  FLOOR_HEIGHT: number;
  MIN_WIDTH: number;
  MAX_WIDTH: number;
  PATH_LENGTH: number;
  PATH_WIDTH_FRAC: number;
}

export const BUILDING_DIMENSIONS = map<BuildingDimensionsConfig>({
  MIN_FLOORS: 1,
  MAX_FLOORS: 50,
  FLOOR_HEIGHT: 10, // scene units per floor
  MIN_WIDTH: 5,
  MAX_WIDTH: 40,
  PATH_LENGTH: 4, // connector strip length (building wall → sidewalk)
  PATH_WIDTH_FRAC: 0.4, // per-building: pathWidth = building.w × this; also drives door width
});

// ─── Color palette (HSL) ───────────────────────────────────────────────────
// Hue comes from HUE_EXT_MAP keyed by file extension; saturation and
// lightness come from these ranges (older files are more muted, newer ones
// brighter). DIRECTORY_COLOR is used for directory buildings.
export interface BuildingPaletteConfig {
  SATURATION_MIN: number;
  SATURATION_MAX: number;
  LIGHTNESS_MIN: number;
  LIGHTNESS_MAX: number;
  DIRECTORY_COLOR: string;
  HUE_EXT_MAP: Record<string, number>;
}

export const BUILDING_PALETTE = map<BuildingPaletteConfig>({
  SATURATION_MIN: 10,
  SATURATION_MAX: 100,
  LIGHTNESS_MIN: 25,
  LIGHTNESS_MAX: 70,
  // (When a file has no creation/modification date, getSaturation /
  // getLightness fall back to the midpoint of the range above so the
  // building reads as "average" rather than crushed to either extreme.)
  DIRECTORY_COLOR: 'hsl(220, 15%, 25%)', // dim slab for directory entries
  // Hue is picked to match the standout color of the file's icon in
  // Material Icon Theme (see views/shell/fileIcon.ts) — the COLOR you
  // see on the file's pill / icon glyph is the same hue the building
  // ramps off in the city. When an icon has multiple colors, we pick
  // the more distinctive one (e.g. Python is yellow+blue → yellow,
  // since blue is overused). Pure-blue icons (.ts, .css) keep blue
  // because there's no alternative in their glyph.
  HUE_EXT_MAP: {
    // JS family — yellow JS, cyan React, blue TS
    '.js': 55,
    '.mjs': 55,
    '.cjs': 55,
    '.jsx': 190,
    '.ts': 210,
    '.tsx': 190,
    '.mts': 210,
    '.cts': 210,
    // Python — pick yellow (blue is the secondary)
    '.py': 50,
    '.pyx': 50,
    '.pyi': 50,
    // Web
    '.html': 13, // HTML orange
    '.htm': 13,
    '.xml': 30, // XML amber
    '.css': 205, // CSS blue (no alternative)
    '.scss': 330, // SASS pink
    '.sass': 330,
    '.less': 250, // LESS blue-purple
    '.vue': 155, // Vue green
    '.svelte': 10, // Svelte orange-red
    // Data / config
    '.json': 50, // JSON yellow
    '.yaml': 358, // YAML red dot
    '.yml': 358,
    '.toml': 30,
    '.ini': 30,
    '.env': 45,
    // Docs
    '.md': 210, // markdown blue (icon's only color)
    '.markdown': 210,
    '.mdx': 210,
    '.txt': 30, // neutral amber
    '.rst': 30,
    // Languages (icon standout colors)
    '.rb': 3, // Ruby red
    '.go': 190, // Go cyan
    '.rs': 25, // Rust orange
    '.java': 32, // Java orange-red
    '.kt': 257, // Kotlin purple
    '.kts': 257,
    '.swift': 17, // Swift orange
    '.c': 210, // C blue
    '.h': 210,
    '.cpp': 220, // C++ blue
    '.cc': 220,
    '.hpp': 220,
    '.cs': 308, // C# purple
    '.php': 237, // PHP purple-indigo
    '.lua': 225, // Lua dark blue
    '.dart': 178, // Dart teal
    '.scala': 0, // Scala red
    '.pl': 280, // Perl purple
    '.r': 210,
    '.ex': 280, // Elixir purple
    '.exs': 280,
    '.erl': 0, // Erlang red
    '.clj': 120, // Clojure green
    '.hs': 280, // Haskell purple
    '.zig': 25,
    '.nim': 55,
    // Shells / build
    '.sh': 130, // terminal green
    '.bash': 130,
    '.zsh': 130,
    '.fish': 130,
    '.ps1': 215,
    // Queries
    '.sql': 200, // SQL teal-blue
    '.graphql': 325, // GraphQL pink
    '.gql': 325,
    // Media
    '.svg': 50, // SVG yellow/gold
    '.png': 290, // image purple/pink
    '.jpg': 290,
    '.jpeg': 290,
    '.gif': 290,
    '.webp': 290,
    '.bmp': 290,
    '.ico': 290,
    '.avif': 290,
    '.mp4': 0, // video red
    '.webm': 0,
    '.mov': 0,
    '.m4v': 0,
    '.ogv': 0,
    '.mkv': 0,
    '.mp3': 285, // audio purple
    '.wav': 285,
    '.flac': 285,
    '.aac': 285,
    '.m4a': 285,
    '.ogg': 285,
    '.pdf': 0, // PDF red
    // Archives
    '.zip': 45, // archive cream/yellow
    '.tar': 45,
    '.gz': 45,
    '.7z': 45,
    '.rar': 45,
    // Other
    '.diff': 120, // additions green
    '.patch': 120,
    '.log': 30,
    '.lock': 45,
  },
});

// ─── Wireframe outlines ────────────────────────────────────────────────────
// Per-building outline stays invisible until the building fades; HOVER +
// SELECTED outlines are dedicated overlays painted over the active building.
// One shared WIDTH for all three outlines — hover/selected differentiate
// via color (white for hover, animated rainbow for selected) rather than
// thickness. The chasing-rainbow effect on selected uses RAINBOW (shared
// with the path line) — see config/effects.js.
export interface BuildingOutlineConfig {
  WIDTH: number;
  HOVER_COLOR: string;
  HOVER_OPACITY: number;
  SELECTED_OPACITY: number;
}

export const BUILDING_OUTLINE = map<BuildingOutlineConfig>({
  WIDTH: 4, // shared by default + hover + selected
  HOVER_COLOR: '#ffffff',
  HOVER_OPACITY: 0.85,
  SELECTED_OPACITY: 1.0,
});

// ─── Visibility / selection-driven fade ────────────────────────────────────
// When something is selected, every other building is categorized by its
// directory-tree distance from the selection and rendered per the matching
// tier's style:
//   DEFAULT — distance 0 (selection's siblings; also the no-selection state)
//   NEAR    — distance 1 (one hop along the directory spine)
//   FAR     — distance ≥2 (cousins, deeper subtrees, unrelated branches)
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
// All hot-reloadable.
export interface BuildingFadeConfig {
  LERP_SPEED: number;
  SNAP_THRESHOLD: number;
  DEFAULT_DETAIL: FadeDetail;
  DEFAULT_OUTLINE: boolean;
  DEFAULT_BODY_OPACITY: number;
  DEFAULT_OUTLINE_OPACITY: number;
  NEAR_DETAIL: FadeDetail;
  NEAR_OUTLINE: boolean;
  NEAR_BODY_OPACITY: number;
  NEAR_OUTLINE_OPACITY: number;
  FAR_DETAIL: FadeDetail;
  FAR_OUTLINE: boolean;
  FAR_BODY_OPACITY: number;
  FAR_OUTLINE_OPACITY: number;
}

export const BUILDING_FADE = map<BuildingFadeConfig>({
  // Animation
  LERP_SPEED: 0.18,
  SNAP_THRESHOLD: 0.005,

  // Default tier — siblings of selection, and the no-selection resting state.
  DEFAULT_DETAIL: FadeDetail.Full,
  DEFAULT_OUTLINE: false,
  DEFAULT_BODY_OPACITY: 1.0,
  DEFAULT_OUTLINE_OPACITY: 1.0,

  // Level 1 — one hop from selection along the directory spine.
  NEAR_DETAIL: FadeDetail.Silhouette,
  NEAR_OUTLINE: true,
  NEAR_BODY_OPACITY: 0.65,
  NEAR_OUTLINE_OPACITY: 1.0,

  // Level 2+ — anything farther.
  FAR_DETAIL: FadeDetail.Silhouette,
  FAR_OUTLINE: true,
  FAR_BODY_OPACITY: 0.1,
  FAR_OUTLINE_OPACITY: 1.0,
});
