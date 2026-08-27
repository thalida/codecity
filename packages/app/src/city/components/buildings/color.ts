// city/components/buildings/color.ts — a building's colour: hue from extension,
// saturation and lightness from how recently it was touched. Both run through
// utils/recency, so dim means nobody has touched this in a long time rather than
// merely that it is the oldest here. getCreatedAge is a separate axis.

import { BUILDINGS } from '@/state/settings/fields/buildings';
import { recencyT } from '@/city/utils/recency';
import { parseDateMs } from '@/utils/dates';
import { DateRanges, NodeKind } from '@codecity/city';

// created/modified stay optional so a sparse mock still reaches the no-date
// branches; a real FileNode always carries both.
interface FileLike {
  type: NodeKind;
  extension?: string;
  created?: string | null;
  modified?: string | null;
  // Open, so an inline mock with only the read fields stays assignable.
  [k: string]: unknown;
}

/** An extension's hue, from the palette or a deterministic hash, so an
 *  extension nobody has picked a colour for still keeps one. */
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

/** An extension as a solid swatch, at the badge's fixed saturation and
 *  lightness, so badges, bars and legend chips all track one another. */
export function extHueColor(extension: string | null, palette: Record<string, number>): string {
  return `hsl(${getHue(extension ?? '', palette)}, 60%, 35%)`;
}

interface MinMaxRange {
  min: number;
  max: number;
}

// Clamped, so a date outside the observed range or a scrub past the recorded
// history still lands inside the configured bounds.
function lerpRange(t: number, config: MinMaxRange): number {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(config.min + clamped * (config.max - config.min));
}

// ── Building color ────────────────────────────────────────────────────────────

/** Weathering from the creation date, 1 for the repo's oldest file. Colour
 *  samples the modified date, so the two say different things. */
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

/** One building's colour, from the palette and the configured ranges. */
export function getBuildingColor(file: FileLike, nowMs: number): string {
  return getBuildingColorForRecency(file, modifiedRecency(file, nowMs));
}

/** How recently a file was touched, from its own age alone: a long-lived file
 *  edited yesterday reads vivid and grimy at once. */
export function modifiedRecency(file: FileLike, nowMs: number): number {
  return recencyT(parseDateMs(file.modified || ''), nowMs, BUILDINGS.value.HALF_LIFE_DAYS);
}

/** getBuildingColor's curve driven by an explicit recency (1 freshest), so the
 *  scrub can re-weather a building each frame through the very same maths. */
export function getBuildingColorForRecency(file: FileLike, recency: number): string {
  const palette = BUILDINGS.value;
  const h = getHue(file.extension || '', palette.HUE_EXT_MAP);
  const s = lerpRange(recency, { min: palette.SATURATION_MIN, max: palette.SATURATION_MAX });
  const l = lerpRange(recency, { min: palette.LIGHTNESS_MIN, max: palette.LIGHTNESS_MAX });
  return `hsl(${h}, ${s}%, ${l}%)`;
}
