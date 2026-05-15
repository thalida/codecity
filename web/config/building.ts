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
  // Saturation + lightness both key off LAST-MODIFIED (see
  // getBuildingColor). Newest files hit SATURATION_MAX × LIGHTNESS_MAX
  // for the richest, most-saturated version of the hue; oldest fall
  // to MIN × MIN — dim and near-gray, the "rundown" look.
  // LIGHTNESS_MAX kept near 55 because L=50 is HSL's peak-chroma
  // point: above that, channels start blending toward white and the
  // hue washes out into pastel. 55 is a touch above peak to keep
  // newest buildings reading as bright, without losing chroma.
  SATURATION_MIN: 0,
  SATURATION_MAX: 100,
  LIGHTNESS_MIN: 10,
  LIGHTNESS_MAX: 50,
  // (When a file has no creation/modification date, getSaturation /
  // getLightness fall back to the midpoint of the range above so the
  // building reads as "average" rather than crushed to either extreme.)
  DIRECTORY_COLOR: 'hsl(220, 15%, 25%)', // dim slab for directory entries
  // Hue is picked to match the standout color of the file's icon in
  // Material Icon Theme (see views/shell/fileIcon.ts) — the COLOR you
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
    '.js': 45,   // javascript: #ffca28 amber
    '.mjs': 45,
    '.cjs': 45,
    '.jsx': 187, // react: #00bcd4 cyan
    '.ts': 201,  // typescript: #0288d1 blue
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
    '.xml': 88,  // xml: #8bc34a light green
    '.css': 261, // css: #7e57c2 purple
    '.scss': 340, // sass: #ec407a pink
    '.sass': 340,
    '.less': 201, // less: #0277bd blue (not purple)
    '.vue': 155,    // vue: #41b883 green
    '.svelte': 14,  // svelte: #ff3e00 orange-red
    // Data / config — `settings` icon (TOML/INI) is blue, not amber.
    '.json': 39, // json: #f9a825 yellow
    '.yaml': 0,  // yaml: #ff5252 red
    '.yml': 0,
    // Generic-glyph icons (settings / document / markdown) are all
    // mono-blue in Material — using their glyph color would dump four
    // file types into the already-crowded blue band. Picking
    // low-frequency hues here keeps the colors readable as filenames
    // alone (config amber, parchment, notes green) without contradicting
    // any strong brand identity.
    '.toml': 25,  // settings → config amber
    '.ini': 25,
    '.env': 45,   // tune: #fbc02d amber
    // Docs
    '.md': 145,   // markdown → notes green
    '.markdown': 145,
    '.mdx': 45,   // mdx: #ffca28 amber
    '.txt': 65,   // document → parchment cream
    '.rst': 65,
    // Languages (icon standout colors)
    '.rb': 4,    // ruby: #f44336 red
    '.go': 187,  // go: #00acc1 cyan
    '.rs': 14,   // rust: #ff7043 deep orange
    '.java': 4,  // java: Material glyph is red (#f44336)
    '.kt': 262,  // kotlin: gradient peaking purple
    '.kts': 262,
    '.swift': 13, // swift: #ff6e40 orange
    '.c': 201,   // c: #0288d1 blue
    '.h': 201,
    '.cpp': 201, // cpp: also #0288d1
    '.cc': 201,
    '.hpp': 201,
    // .cs / .php: Material's glyphs are blue, but the canonical brand
    // colors are purple — and the 200–210 blue band is already crowded
    // with TS / C / C++. Using brand colors here adds variety while
    // staying faithful to the language identity users recognize.
    '.cs': 290,  // C# Microsoft purple
    '.php': 237, // PHP indigo
    '.lua': 199, // lua: #4fc3f7/#01579b blues
    '.dart': 4,  // dart: Material glyph is red, not teal
    '.scala': 290, // scala: #ba68c8 purple (not red)
    '.pl': 30,   // Perl: glyph is mono-blue; push to onion amber (brand-association)
    '.r': 258,   // r: #9575cd purple
    '.ex': 4,    // elixir: Material glyph is red, not purple
    '.exs': 4,
    '.erl': 95,  // Erlang: glyph blue-dominant but crowded; push to sage green
    '.clj': 1,   // clojure: mixed warm; dominant #ef5350 red
    '.hs': 39,   // haskell: #f9a825 amber (not purple)
    '.zig': 39,  // zig: #f9a825 amber
    '.nim': 45,  // nim: #ffca28 amber
    // Shells / build — `console` glyph is orange, not green.
    '.sh': 14,   // console: #ff7043 orange
    '.bash': 14,
    '.zsh': 14,
    '.fish': 14,
    '.ps1': 199, // powershell: #03a9f4 blue
    // Queries
    '.sql': 45,  // database: #ffca28 amber (not teal-blue)
    '.graphql': 340, // graphql: #ec407a pink
    '.gql': 340,
    // Media — image is teal, video is orange, audio is red (NOT purple).
    '.svg': 43,  // svg: #ffb300 amber
    '.png': 174, // image: #26a69a teal
    '.jpg': 174,
    '.jpeg': 174,
    '.gif': 174,
    '.webp': 174,
    '.bmp': 174,
    '.ico': 174,
    '.avif': 174,
    '.mp4': 35,  // video: #ff9800 orange
    '.webm': 35,
    '.mov': 35,
    '.m4v': 35,
    '.ogv': 35,
    '.mkv': 35,
    '.mp3': 1,   // audio: #ef5350 red
    '.wav': 1,
    '.flac': 1,
    '.aac': 1,
    '.m4a': 1,
    '.ogg': 1,
    '.pdf': 1,   // pdf: #ef5350 red
    // Archives
    '.zip': 64,  // zip: #afb42b olive (not cream)
    '.tar': 64,
    '.gz': 64,
    '.7z': 64,
    '.rar': 64,
    // Diff glyph is mono-blue too; pushing to a green-yellow keeps it
    // semantically "additions" while spacing it from the blue cluster.
    '.diff': 110, // diff → additions green
    '.patch': 110,
    '.log': 64,  // log: #afb42b olive
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
  HOVER_OPACITY: 0.85,
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
// Both are hot-reloadable; refreshBuildingMaterial pushes the values
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
  GRIME_INTENSITY: 0.7,
  GRIME_COVERAGE: 0.55,
  TILT_ENABLED: true,
  TILT_DEGREES: 1,
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
  NEAR_BODY_OPACITY: 0.5,
  NEAR_OUTLINE_OPACITY: 0.5,

  // Level 2+ — anything farther.
  FAR_DETAIL: FadeDetail.Silhouette,
  FAR_OUTLINE: true,
  FAR_BODY_OPACITY: 0.05,
  FAR_OUTLINE_OPACITY: 0.5,
});
