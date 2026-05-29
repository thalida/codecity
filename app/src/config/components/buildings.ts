// config/building.js — Everything visual about a building: dimensions,
// palette, outline, and selection-driven fade tiers.
//
// DIMENSIONS + PALETTE changes are rebuild-required (regenerate per-building
// geometry / facade textures). OUTLINE + FADE are applied on Save via applyTheme().

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
// DISTANCE_FROM_ROAD is the gap perpendicular to the street between the
// building wall and the street edge. Same for every building.
export interface BuildingDimensionsConfig {
  MIN_FLOORS: number;
  MAX_FLOORS: number;
  FLOOR_HEIGHT: number;
  MIN_WIDTH: number;
  MAX_WIDTH: number;
  DISTANCE_FROM_ROAD: number;
}

export const BUILDING_DIMENSIONS = map<BuildingDimensionsConfig>({
  MIN_FLOORS: 2,
  MAX_FLOORS: 64,
  FLOOR_HEIGHT: 16, // scene units per floor
  MIN_WIDTH: 8,
  MAX_WIDTH: 96,
  DISTANCE_FROM_ROAD: 8, // distance from building wall to street edge
});

// ─── Color palette (HSL) ───────────────────────────────────────────────────
// Hue comes from HUE_EXT_MAP keyed by file extension; saturation and
// lightness come from these ranges (older files are more muted, newer ones
// brighter).
export interface BuildingPaletteConfig {
  SATURATION_MIN: number;
  SATURATION_MAX: number;
  LIGHTNESS_MIN: number;
  LIGHTNESS_MAX: number;
  HUE_EXT_MAP: Record<string, number>;
}

export const BUILDING_PALETTE = map<BuildingPaletteConfig>({
  // Saturation + lightness both key off LAST-MODIFIED (see
  // getBuildingColor). Newest files hit SATURATION_MAX × LIGHTNESS_MAX
  // for the richest, most-saturated version of the hue; oldest fall
  // to MIN × MIN — dim and near-gray, the "rundown" look.
  // LIGHTNESS_MAX kept near 55 because L=50 is HSL's peak-chroma
  // point: above that, channels start blending toward white and the
  // hue washes out into pastel. 55 is a touch above peak to keep
  // newest buildings reading as bright, without losing chroma.
  SATURATION_MIN: 5,
  SATURATION_MAX: 100,
  LIGHTNESS_MIN: 5,
  LIGHTNESS_MAX: 50,
  // (When a file has no creation/modification date, getSaturation /
  // getLightness fall back to the midpoint of the range above so the
  // building reads as "average" rather than crushed to either extreme.)
  // Hue is picked to match the standout color of the file's icon in
  // Material Icon Theme (see views/widgets/fileIcon.ts) — the COLOR you
  // see on the file's pill / icon glyph is the same hue the building
  // ramps off in the city. When an icon has multiple colors, we pick
  // the more distinctive one (e.g. Python is yellow+blue → yellow,
  // since blue is overused).
  HUE_EXT_MAP: {
    // Hues audited against the actual Material Icon Theme SVG fill
    // colors at jsdelivr (v5.30.0). When an icon has multiple fills
    // we pick the dominant brand color; mixed-palette icons (Erlang,
    // Clojure, Python's yellow+blue) get the more distinctive one.

    // JS family
    '.js': 45, // javascript: #ffca28 amber
    '.mjs': 45,
    '.cjs': 45,
    '.jsx': 187, // react: #00bcd4 cyan
    '.ts': 201, // typescript: #0288d1 blue
    '.tsx': 201, // react_ts: also #0288d1 (TS-themed react)
    '.mts': 201,
    '.cts': 201,
    // Python — pick yellow (blue is the secondary)
    '.py': 52,
    '.pyx': 52,
    '.pyi': 52,
    // Web
    '.html': 19, // html: #e65100 deep orange
    '.htm': 19,
    '.xml': 88, // xml: #8bc34a light green
    '.css': 261, // css: #7e57c2 purple
    '.scss': 340, // sass: #ec407a pink
    '.sass': 340,
    '.less': 201, // less: #0277bd blue (not purple)
    '.vue': 155, // vue: #41b883 green
    '.svelte': 14, // svelte: #ff3e00 orange-red
    // Data / config — `settings` icon (TOML/INI) is blue, not amber.
    '.json': 39, // json: #f9a825 yellow
    '.yaml': 0, // yaml: #ff5252 red
    '.yml': 0,
    // Generic-glyph icons (settings / document / markdown) are all
    // mono-blue in Material — using their glyph color would dump four
    // file types into the already-crowded blue band. Picking
    // low-frequency hues here keeps the colors readable as filenames
    // alone (config amber, parchment, notes green) without contradicting
    // any strong brand identity.
    '.toml': 25, // settings → config amber
    '.ini': 25,
    '.env': 45, // tune: #fbc02d amber
    // Docs
    '.md': 145, // markdown → notes green
    '.markdown': 145,
    '.mdx': 45, // mdx: #ffca28 amber
    '.txt': 65, // document → parchment cream
    '.rst': 65,
    // Languages (icon standout colors)
    '.rb': 4, // ruby: #f44336 red
    '.go': 187, // go: #00acc1 cyan
    '.rs': 14, // rust: #ff7043 deep orange
    '.java': 4, // java: Material glyph is red (#f44336)
    '.kt': 262, // kotlin: gradient peaking purple
    '.kts': 262,
    '.swift': 13, // swift: #ff6e40 orange
    '.c': 201, // c: #0288d1 blue
    '.h': 201,
    '.cpp': 201, // cpp: also #0288d1
    '.cc': 201,
    '.hpp': 201,
    // .cs / .php: Material's glyphs are blue, but the canonical brand
    // colors are purple — and the 200–210 blue band is already crowded
    // with TS / C / C++. Using brand colors here adds variety while
    // staying faithful to the language identity users recognize.
    '.cs': 290, // C# Microsoft purple
    '.php': 237, // PHP indigo
    '.lua': 199, // lua: #4fc3f7/#01579b blues
    '.dart': 4, // dart: Material glyph is red, not teal
    '.scala': 290, // scala: #ba68c8 purple (not red)
    '.pl': 30, // Perl: glyph is mono-blue; push to onion amber (brand-association)
    '.r': 258, // r: #9575cd purple
    '.ex': 4, // elixir: Material glyph is red, not purple
    '.exs': 4,
    '.erl': 95, // Erlang: glyph blue-dominant but crowded; push to sage green
    '.clj': 1, // clojure: mixed warm; dominant #ef5350 red
    '.hs': 39, // haskell: #f9a825 amber (not purple)
    '.zig': 39, // zig: #f9a825 amber
    '.nim': 45, // nim: #ffca28 amber
    // Shells / build — `console` glyph is orange, not green.
    '.sh': 14, // console: #ff7043 orange
    '.bash': 14,
    '.zsh': 14,
    '.fish': 14,
    '.ps1': 199, // powershell: #03a9f4 blue
    // Queries
    '.sql': 45, // database: #ffca28 amber (not teal-blue)
    '.graphql': 340, // graphql: #ec407a pink
    '.gql': 340,
    // Media — image is teal, video is orange, audio is red (NOT purple).
    '.svg': 43, // svg: #ffb300 amber
    '.png': 174, // image: #26a69a teal
    '.jpg': 174,
    '.jpeg': 174,
    '.gif': 174,
    '.webp': 174,
    '.bmp': 174,
    '.ico': 174,
    '.avif': 174,
    '.mp4': 35, // video: #ff9800 orange
    '.webm': 35,
    '.mov': 35,
    '.m4v': 35,
    '.ogv': 35,
    '.mkv': 35,
    '.mp3': 1, // audio: #ef5350 red
    '.wav': 1,
    '.flac': 1,
    '.aac': 1,
    '.m4a': 1,
    '.ogg': 1,
    '.pdf': 1, // pdf: #ef5350 red
    // Archives
    '.zip': 64, // zip: #afb42b olive (not cream)
    '.tar': 64,
    '.gz': 64,
    '.7z': 64,
    '.rar': 64,
    // Diff glyph is mono-blue too; pushing to a green-yellow keeps it
    // semantically "additions" while spacing it from the blue cluster.
    '.diff': 110, // diff → additions green
    '.patch': 110,
    '.log': 64, // log: #afb42b olive
    '.lock': 46, // lock: #ffd54f amber
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
  HOVER_OPACITY: 0.5,
  SELECTED_OPACITY: 1.0,
});

// ─── Age-driven visual decay ───────────────────────────────────────────────
// Both effects key off `createdAge` (0=newest creation, 1=oldest in the
// repo) — independent of color, which tracks last-modified. So an
// often-edited but originally-old file still reads as weathered.
//
//   GRIME — vertical streaks running down the facade. INTENSITY scales
//           the per-pixel darkening; COVERAGE controls how many bands
//           the oldest building shows.
//   TILT  — small lean around the building's base. DEGREES = max tilt
//           for the oldest building. Direction is hashed per-instance
//           so the lean is stable but city-wide varied.
//
// Both are applied on Save via applyTheme(); refreshBuildingMaterial pushes the values
// into the building shader's uniforms.
export interface BuildingAgingConfig {
  GRIME_ENABLED: boolean;
  GRIME_INTENSITY: number;
  GRIME_COVERAGE: number;
  TILT_ENABLED: boolean;
  TILT_DEGREES: number;
}

export const BUILDING_AGING = map<BuildingAgingConfig>({
  GRIME_ENABLED: true,
  GRIME_INTENSITY: 0.75,
  GRIME_COVERAGE: 0.55,
  TILT_ENABLED: true,
  TILT_DEGREES: 1,
});

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

export const BUILDING_FADE = map<BuildingFadeConfig>({
  // Default tier — applies to the selected/hovered building itself
  // and to every building when nothing is selected (idle state).
  DEFAULT_DETAIL: FadeDetail.Full,
  DEFAULT_OUTLINE: false,
  DEFAULT_BODY_OPACITY: 1.0,
  DEFAULT_OUTLINE_OPACITY: 1.0,

  // Level 1 — same dir as the selection (or the dir's direct files).
  LEVEL1_DETAIL: FadeDetail.Silhouette,
  LEVEL1_OUTLINE: true,
  LEVEL1_BODY_OPACITY: 0.75,
  LEVEL1_OUTLINE_OPACITY: 0.75,

  // Level 2 — one directory deeper than the selection.
  LEVEL2_DETAIL: FadeDetail.Silhouette,
  LEVEL2_OUTLINE: true,
  LEVEL2_BODY_OPACITY: 0.1,
  LEVEL2_OUTLINE_OPACITY: 0.5,

  // Level 3 — deeper descendants (two or more directories below).
  LEVEL3_DETAIL: FadeDetail.Silhouette,
  LEVEL3_OUTLINE: true,
  LEVEL3_BODY_OPACITY: 0.1,
  LEVEL3_OUTLINE_OPACITY: 0.5,

  // Level 4 — outside the selection's subtree entirely.
  LEVEL4_DETAIL: FadeDetail.Hidden,
  LEVEL4_OUTLINE: true,
  LEVEL4_BODY_OPACITY: 0.1,
  LEVEL4_OUTLINE_OPACITY: 0.5,
});
