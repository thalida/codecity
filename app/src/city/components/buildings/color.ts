// city/components/buildings/color.ts — HSL mapping from file metadata.
//   Hue        → file extension          (palette; deterministic hash for unknowns)
//   Saturation → last-modified date      (recent = vivid, stale = faded)
//   Lightness  → last-modified date      (recent = bright, stale = dim)
//
// Both key off the same axis (last-modified) through city/utils/recency, so the
// dim end means "nobody has touched this in a long time" rather than merely
// "this is the oldest one here".
// `getCreatedAge` (also exported here) tracks a SEPARATE axis: how long
// the file has existed in the repo. That drives grime + lit-window
// glow color in the shader, independent of recent edits.
//
// Tunables come from BUILDINGS in state/stores/settings/buildings.ts. Tests
// set the signals directly in setup + restore in teardown.

import { BUILDINGS } from '@/state/stores/settings/buildings';
import { recencyT } from '@/city/utils/recency';
import { NodeKind } from '@/types';
import type { DateRanges } from '@/types';
import { parseDateMs } from '@/utils/dates';

// Structural shape matches what a real FileNode supplies but also
// accommodates test mocks that omit unrelated fields. created/modified
// stay optional so sparse mocks still hit the no-date midpoint branches;
// real FileNodes always carry both (resolved server-side).
interface FileLike {
  type: NodeKind;
  extension?: string;
  created?: string | null;
  modified?: string | null;
  // Open shape: real FileNode/DirNode have many other fields the helpers
  // don't read (name, path, etc). Index signature keeps inline test
  // mocks structurally compatible.
  [k: string]: unknown;
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

/**
 * The badge/chip fill color for a file extension: the extension's hue at the
 * KindBadge's fixed saturation/lightness (`hsl(hue, 60%, 35%)`, matching
 * its CSS `hsl(var(--badge-hue), 60%, 35%)`). Used wherever an ext is painted
 * as a solid swatch — badges, composition bars, legend chips — so they all
 * track one another. `null`/'' (extensionless) hues off '' like the dir chip.
 *
 * @param {string|null} extension - File extension including the dot (".ts"), or
 *                                   null/'' for extensionless files.
 * @param {Object} palette         - Map of extension → hue.
 * @returns {string} CSS HSL string, e.g. "hsl(215, 60%, 35%)".
 */
export function extHueColor(extension: string | null, palette: Record<string, number>): string {
  return `hsl(${getHue(extension ?? '', palette)}, 60%, 35%)`;
}

interface MinMaxRange {
  min: number;
  max: number;
}

// t=0 → config.min
// (oldest/weathered), t=1 → config.max (newest/vivid). Clamped so out-of-range t
// (e.g. dates outside the observed range, or a scrub position past the recorded
// history) still lands inside the configured bounds.
function lerpRange(t: number, config: MinMaxRange): number {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(config.min + clamped * (config.max - config.min));
}

// ── Building color ────────────────────────────────────────────────────────────

/**
 * Compute the "createdAge" weathering signal for a building, sampled at
 * the file's CREATION date and normalized against the repo's
 * minCreated/maxCreated. 1.0 = oldest file in the repo (most weathered),
 * 0.0 = newest. Same time anchor the color signal uses (which samples
 * at modified date), so both signals evolve together as the repo grows.
 */
export function getCreatedAge(file: FileLike, dateRanges: DateRanges): number {
  const created = file.created || null;
  if (!created) return 0.5; // unknown → midpoint (half-weathered)
  const c = parseDateMs(created);
  const min = parseDateMs(dateRanges.minCreated || '');
  const max = parseDateMs(dateRanges.maxCreated || '');
  if (isNaN(c) || isNaN(min) || isNaN(max) || max === min) return 0;
  const t = (c - min) / (max - min);
  return Math.max(0, Math.min(1, 1 - t));
}

/** The colour axis inverted for the shader's iModifiedAge: 1 = longest
 *  untouched. Shares modifiedRecency so Live and Timeline agree at HEAD. */
export function getModifiedAge(file: FileLike, nowMs: number): number {
  return 1 - modifiedRecency(file, nowMs);
}

/**
 * Compute the full HSL color string for a single file building. Pulls
 * palette + saturation/lightness ranges from BUILDING in defaults.js.
 *
 * @param {Object} file       - File node from the scanner manifest.
 * @param {Object} dateRanges - Manifest.dateRanges (backend-computed).
 * @returns {string} CSS HSL string, e.g. "hsl(215, 80%, 55%)".
 */
export function getBuildingColor(file: FileLike, nowMs: number): string {
  return getBuildingColorForRecency(file, modifiedRecency(file, nowMs));
}

/**
 * How recently a file was touched, from its own age alone.
 *
 * A separate axis from getCreatedAge (grime, window glow), which ranks by
 * CREATION: colour is "how recently was this touched", those are "how long has
 * this existed". A long-lived file edited yesterday reads vivid AND grimy.
 */
export function modifiedRecency(file: FileLike, nowMs: number): number {
  return recencyT(parseDateMs(file.modified || ''), nowMs, BUILDINGS.value.HALF_LIFE_DAYS);
}

/**
 * Same hue lookup + saturation/lightness curve as getBuildingColor, but driven
 * by an explicit recency (0 = oldest/weathered, 1 = just modified) instead of
 * a date lookup against dateRanges. Lets the Timeline scrub controller
 * re-evaluate a building's weathering relative to the scrub position each
 * frame, reusing the exact same curve the static build-time color uses.
 *
 * @param {Object} file    - File node (only `extension` is read).
 * @param {number} recency - 0..1, 1 = freshest.
 * @returns {string} CSS HSL string, e.g. "hsl(215, 80%, 55%)".
 */
export function getBuildingColorForRecency(file: FileLike, recency: number): string {
  const palette = BUILDINGS.value;
  const h = getHue(file.extension || '', palette.HUE_EXT_MAP);
  const s = lerpRange(recency, { min: palette.SATURATION_MIN, max: palette.SATURATION_MAX });
  const l = lerpRange(recency, { min: palette.LIGHTNESS_MIN, max: palette.LIGHTNESS_MAX });
  return `hsl(${h}, ${s}%, ${l}%)`;
}
