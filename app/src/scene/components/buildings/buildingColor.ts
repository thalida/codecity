// colors.ts — HSL mapping from file metadata.
//   Hue        → file extension          (palette; deterministic hash for unknowns)
//   Saturation → last-modified date      (recent = vivid, stale = faded)
//   Lightness  → last-modified date      (recent = bright, stale = dim)
//
// Both saturation and lightness key off the same axis (last-modified),
// normalized against the repo's modifiedMin/Max — so the dim/desaturated
// end represents "this file hasn't been touched in a long time".
// `getCreatedAge` (also exported here) tracks a SEPARATE axis: how long
// the file has existed in the repo. That drives grime + tilt + lit-window
// glow color in the shader, independent of recent edits.
//
// Tunables come from BUILDING_PALETTE in config/building.ts. Tests
// mutate the store via .setKey() in setup + restore in teardown.

import { BUILDING_PALETTE } from '@/state/settings/components/buildings';
import { NodeKind } from '@/types';

// Structural shapes match what real Manifest tree / FileNode supply but
// also accommodate test mocks that omit unrelated fields. Real callers
// pass full TreeNode / FileNode instances — both are structurally
// compatible with these.
interface FileLike {
  type: NodeKind;
  extension?: string;
  git?: { created?: string | null; modified?: string | null } | null;
  created?: string | null;
  modified?: string | null;
  // Open shape: real FileNode/DirNode have many other fields the helpers
  // don't read (name, path, etc). Index signature keeps inline test
  // mocks structurally compatible.
  [k: string]: unknown;
}
interface TreeNodeLike extends FileLike {
  children?: TreeNodeLike[];
}

/**
 * Map a file extension to a hue value (0–359).
 *
 * Checks the palette object first (e.g. { ".ts": 215, ".py": 15 }).
 * For extensions not present in the palette, falls back to a deterministic
 * hash so the same extension always gets the same colour.
 *
 * @param {string} extension - File extension including the dot, e.g. ".ts".
 *                             Pass an empty string for files with no extension.
 * @param {Object} palette   - Map of extension → hue from defaults.js.
 * @returns {number} Integer hue in [0, 359].
 */
export function getHue(extension: string, palette: Record<string, number>): number {
  // Direct palette lookup
  if (palette && Object.hasOwn(palette, extension)) {
    return palette[extension];
  }

  // Deterministic hash for unknown extensions
  let hash = 0;
  for (const ch of extension) {
    hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

// ── Saturation ────────────────────────────────────────────────────────────────

/**
 * Compute saturation (%) interpolated linearly between a min/max date range.
 *
 * Dates closer to maxDate → config.max saturation (vivid).
 * Dates closer to minDate → config.min saturation (faded/grey).
 * Linear interpolation between the two extremes.
 *
 * @param {string|null} date   - ISO-8601 date string to sample within the range.
 * @param {string|null} minDate - Earliest date in the range (ISO-8601).
 * @param {string|null} maxDate - Latest date in the range (ISO-8601).
 * @param {Object}      config      - { min: number, max: number } (e.g. { min: 20, max: 100 }).
 * @returns {number} Saturation percentage, clamped to [config.min, config.max].
 */
interface MinMaxRange {
  min: number;
  max: number;
}

export function getSaturation(
  date: string | null,
  minDate: string | null,
  maxDate: string | null,
  config: MinMaxRange
): number {
  // Fallback: no date available → mid-point of the configured range
  if (!date) {
    return Math.round((config.min + config.max) / 2);
  }

  const dateVal = Date.parse(date);
  const min = Date.parse(minDate);
  const max = Date.parse(maxDate);

  // Guard: if all files share the same date (or range is degenerate), use max
  if (!min || !max || max === min) {
    return config.max;
  }

  // t=0 → oldest (min saturation), t=1 → newest (max saturation)
  let t = (dateVal - min) / (max - min);

  // Clamp t to [0, 1] in case dates fall outside the observed range
  t = Math.max(0, Math.min(1, t));

  return Math.round(config.min + t * (config.max - config.min));
}

// ── Lightness ─────────────────────────────────────────────────────────────────

/**
 * Compute lightness (%) interpolated linearly between a min/max date range.
 *
 * Dates closer to maxDate → config.max lightness (bright).
 * Dates closer to minDate → config.min lightness (dim).
 * Linear interpolation between the two extremes.
 *
 * @param {string|null} date   - ISO-8601 date string to sample within the range.
 * @param {string|null} minDate - Earliest date in the range (ISO-8601).
 * @param {string|null} maxDate - Latest date in the range (ISO-8601).
 * @param {Object}      config       - { min: number, max: number } (e.g. { min: 25, max: 70 }).
 * @returns {number} Lightness percentage, clamped to [config.min, config.max].
 */
export function getLightness(
  date: string | null,
  minDate: string | null,
  maxDate: string | null,
  config: MinMaxRange
): number {
  // Fallback: no date available → mid-point of the configured range
  if (!date) {
    return Math.round((config.min + config.max) / 2);
  }

  const dateVal = Date.parse(date);
  const min = Date.parse(minDate);
  const max = Date.parse(maxDate);

  // Guard: degenerate range → use max (treat as recently modified)
  if (!min || !max || max === min) {
    return config.max;
  }

  // t=0 → oldest modification (min lightness), t=1 → newest (max lightness)
  let t = (dateVal - min) / (max - min);

  // Clamp to [0, 1]
  t = Math.max(0, Math.min(1, t));

  return Math.round(config.min + t * (config.max - config.min));
}

// ── Date range scan ───────────────────────────────────────────────────────────

/**
 * Walk the manifest tree recursively and collect the min/max creation and
 * modification timestamps across every file node.
 *
 * Prefers git dates (file.git.created / file.git.modified) and falls back to
 * filesystem dates (file.created / file.modified).
 *
 * @param {Object} manifestTree - Root node of the scanner manifest tree.
 * @returns {{ createdMin: string|null, createdMax: string|null,
 *             modifiedMin: string|null, modifiedMax: string|null }}
 */
export interface DateRangeStrings {
  createdMin: string | null;
  createdMax: string | null;
  modifiedMin: string | null;
  modifiedMax: string | null;
}

export function getDateRanges(tree: TreeNodeLike): DateRangeStrings {
  let createdMin: string | null = null;
  let createdMax: string | null = null;
  let modifiedMin: string | null = null;
  let modifiedMax: string | null = null;

  function earlier(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
  }

  function later(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  function visit(node: TreeNodeLike): void {
    if (node.type === NodeKind.File) {
      // Prefer git dates, fall back to filesystem dates
      const created = (node.git && node.git.created) || node.created || null;
      const modified = (node.git && node.git.modified) || node.modified || null;

      createdMin = earlier(createdMin, created);
      createdMax = later(createdMax, created);
      modifiedMin = earlier(modifiedMin, modified);
      modifiedMax = later(modifiedMax, modified);
    }

    // Recurse into directory children
    if (node.children?.length) {
      for (const child of node.children) visit(child);
    }
  }

  visit(tree);

  return {
    createdMin,
    createdMax,
    modifiedMin,
    modifiedMax,
  };
}

// ── Building color ────────────────────────────────────────────────────────────

/**
 * Compute the full HSL color string for a single file building. Pulls
 * palette + saturation/lightness ranges from BUILDING in defaults.js.
 *
 * @param {Object} file       - File node from the scanner manifest.
 * @param {Object} dateRanges - Output of getDateRanges().
 * @returns {string} CSS HSL string, e.g. "hsl(215, 80%, 55%)".
 */
/**
 * Compute the "createdAge" weathering signal for a building, sampled at
 * the file's CREATION date and normalized against the repo's
 * createdMin/createdMax. 1.0 = oldest file in the repo (most weathered),
 * 0.0 = newest. Same time anchor the color signal uses (which samples
 * at modified date), so both signals evolve together as the repo grows.
 */
export function getCreatedAge(file: FileLike, dateRanges: DateRangeStrings): number {
  const created = (file.git && file.git.created) || file.created || null;
  if (!created) return 0.5; // unknown → midpoint (half-weathered)
  const c = Date.parse(created);
  const min = Date.parse(dateRanges.createdMin || '');
  const max = Date.parse(dateRanges.createdMax || '');
  if (isNaN(c) || isNaN(min) || isNaN(max) || max === min) return 0;
  const t = (c - min) / (max - min);
  return Math.max(0, Math.min(1, 1 - t));
}

/**
 * Mirror of getCreatedAge for the LAST-MODIFIED axis. Sampled at the
 * file's modified date, normalized against modifiedMin/Max. Polarity
 * matches getCreatedAge: 1.0 = file modified earliest in the repo
 * (most stale); 0.0 = most recently modified.
 *
 * Shader-side: passed in via iModifiedAge (per-instance attribute) and
 * read as `vModifiedAge` in the building fragment shader.
 */
export function getModifiedAge(file: FileLike, dateRanges: DateRangeStrings): number {
  const modified = (file.git && file.git.modified) || file.modified || null;
  if (!modified) return 0.5;
  const m = Date.parse(modified);
  const min = Date.parse(dateRanges.modifiedMin || '');
  const max = Date.parse(dateRanges.modifiedMax || '');
  if (isNaN(m) || isNaN(min) || isNaN(max) || max === min) return 0;
  const t = (m - min) / (max - min);
  return Math.max(0, Math.min(1, 1 - t));
}

export function getBuildingColor(file: FileLike, dateRanges: DateRangeStrings): string {
  // Prefer git dates, fall back to filesystem dates
  const modified = (file.git && file.git.modified) || file.modified || null;

  const palette = BUILDING_PALETTE.get();
  const h = getHue(file.extension || '', palette.HUE_EXT_MAP);
  // Saturation and lightness both key off LAST-MODIFIED, normalized
  // against the repo's MODIFIED-date range (modifiedMin/Max). This
  // gives the color signal full spread: a file modified at the
  // earliest modification timestamp in the repo lands at
  // (SATURATION_MIN, LIGHTNESS_MIN); the most-recently-modified file
  // lands at (SATURATION_MAX, LIGHTNESS_MAX).
  //
  // Decoupled by design from createdAge-driven effects (grime, tilt,
  // lit-window glow color), which still anchor against createdMin/Max:
  //   - Color           = "how recently was this touched"
  //   - Grime/tilt/glow = "how long has this file existed"
  // A long-existing file edited yesterday looks vivid AND grimy; a
  // recently-created file untouched for a month looks dim/desaturated
  // but clean. Each axis encodes a distinct fact.
  const minAnchor = dateRanges.modifiedMin;
  const maxAnchor = dateRanges.modifiedMax;
  const s = getSaturation(modified, minAnchor, maxAnchor, {
    min: palette.SATURATION_MIN,
    max: palette.SATURATION_MAX,
  });
  const l = getLightness(modified, minAnchor, maxAnchor, {
    min: palette.LIGHTNESS_MIN,
    max: palette.LIGHTNESS_MAX,
  });

  return `hsl(${h}, ${s}%, ${l}%)`;
}
