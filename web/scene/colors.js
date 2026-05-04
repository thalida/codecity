// colors.js — HSL mapping from file metadata.
//   Hue        → file extension  (palette, deterministic hash for unknowns)
//   Saturation → creation age    (newer = vivid, older = faded)
//   Lightness  → last modified   (recent = bright, untouched = dim)
//
// Tunables come from BUILDING_PALETTE in src/config/building.js. Tests
// mutate the store via .setKey() in setup + restore in teardown.

import { BUILDING_PALETTE } from '../config/index.js';

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
export function getHue(extension, palette) {
  // Direct palette lookup
  if (palette && Object.prototype.hasOwnProperty.call(palette, extension)) {
    return palette[extension];
  }

  // Deterministic hash for unknown extensions
  var hash = 0;
  for (var i = 0; i < extension.length; i++) {
    hash = extension.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

// ── Saturation ────────────────────────────────────────────────────────────────

/**
 * Compute saturation (%) based on when the file was first created.
 *
 * Newer files (closer to maxDate) → config.max saturation (vivid).
 * Older files (closer to minDate) → config.min saturation (faded/grey).
 * Linear interpolation between the two extremes.
 *
 * @param {string|null} createdDate - ISO-8601 date string for file creation.
 * @param {string|null} minDate     - Earliest creation date in the repo (ISO-8601).
 * @param {string|null} maxDate     - Latest creation date in the repo (ISO-8601).
 * @param {Object}      config      - { min: number, max: number } (e.g. { min: 20, max: 100 }).
 * @returns {number} Saturation percentage, clamped to [config.min, config.max].
 */
export function getSaturation(createdDate, minDate, maxDate, config) {
  // Fallback: no date available → mid-point of the configured range
  if (!createdDate) {
    return Math.round((config.min + config.max) / 2);
  }

  var created = Date.parse(createdDate);
  var min     = Date.parse(minDate);
  var max     = Date.parse(maxDate);

  // Guard: if all files share the same date (or range is degenerate), use max
  if (!min || !max || max === min) {
    return config.max;
  }

  // t=0 → oldest (min saturation), t=1 → newest (max saturation)
  var t = (created - min) / (max - min);

  // Clamp t to [0, 1] in case dates fall outside the observed range
  t = Math.max(0, Math.min(1, t));

  return Math.round(config.min + t * (config.max - config.min));
}

// ── Lightness ─────────────────────────────────────────────────────────────────

/**
 * Compute lightness (%) based on when the file was last modified.
 *
 * Recently modified files (closer to maxDate) → config.max lightness (bright).
 * Long-untouched files (closer to minDate)    → config.min lightness (dim).
 * Linear interpolation between the two extremes.
 *
 * @param {string|null} modifiedDate - ISO-8601 date string for last modification.
 * @param {string|null} minDate      - Earliest modification date in the repo (ISO-8601).
 * @param {string|null} maxDate      - Latest modification date in the repo (ISO-8601).
 * @param {Object}      config       - { min: number, max: number } (e.g. { min: 25, max: 70 }).
 * @returns {number} Lightness percentage, clamped to [config.min, config.max].
 */
export function getLightness(modifiedDate, minDate, maxDate, config) {
  // Fallback: no date available → mid-point of the configured range
  if (!modifiedDate) {
    return Math.round((config.min + config.max) / 2);
  }

  var modified = Date.parse(modifiedDate);
  var min      = Date.parse(minDate);
  var max      = Date.parse(maxDate);

  // Guard: degenerate range → use max (treat as recently modified)
  if (!min || !max || max === min) {
    return config.max;
  }

  // t=0 → oldest modification (min lightness), t=1 → newest (max lightness)
  var t = (modified - min) / (max - min);

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
export function getDateRanges(manifestTree) {
  var createdMin  = null;
  var createdMax  = null;
  var modifiedMin = null;
  var modifiedMax = null;

  /**
   * Compare two ISO-8601 strings and return the earlier one.
   * Null values are ignored (non-null always wins).
   */
  function earlier(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
  }

  /**
   * Compare two ISO-8601 strings and return the later one.
   * Null values are ignored (non-null always wins).
   */
  function later(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  /**
   * Recursively visit every node in the tree.
   * @param {Object} node - A file or directory node.
   */
  function visit(node) {
    if (node.type === "file") {
      // Prefer git dates, fall back to filesystem dates
      var created  = (node.git && node.git.created)  || node.created  || null;
      var modified = (node.git && node.git.modified) || node.modified || null;

      createdMin  = earlier(createdMin,  created);
      createdMax  = later(createdMax,    created);
      modifiedMin = earlier(modifiedMin, modified);
      modifiedMax = later(modifiedMax,   modified);
    }

    // Recurse into directory children
    if (node.children && node.children.length > 0) {
      for (var i = 0; i < node.children.length; i++) {
        visit(node.children[i]);
      }
    }
  }

  visit(manifestTree);

  return {
    createdMin:  createdMin,
    createdMax:  createdMax,
    modifiedMin: modifiedMin,
    modifiedMax: modifiedMax
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
export function getBuildingColor(file, dateRanges) {
  // Prefer git dates, fall back to filesystem dates
  var created  = (file.git && file.git.created)  || file.created  || null;
  var modified = (file.git && file.git.modified) || file.modified || null;

  var palette = BUILDING_PALETTE.get();
  var h = getHue(file.extension || "", palette.HUE_EXT_MAP);
  var s = getSaturation(created,  dateRanges.createdMin,  dateRanges.createdMax,
                        { min: palette.SATURATION_MIN, max: palette.SATURATION_MAX });
  var l = getLightness(modified,  dateRanges.modifiedMin, dateRanges.modifiedMax,
                        { min: palette.LIGHTNESS_MIN,  max: palette.LIGHTNESS_MAX });

  return "hsl(" + h + ", " + s + "%, " + l + "%)";
}
