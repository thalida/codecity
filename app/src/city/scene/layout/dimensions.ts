// city/layout/dimensions.ts — file/building sizing and street width derivation.
// Pure functions over manifest stats and settings stores; no DOM or Three.js.

import type { BuildingDimensionsConfig } from '@/city/session/settings/buildings';
import type { StreetTier } from '@/city/session/settings/streets';
import type { RangeStat, RepoStats } from '@/types';
import { isMediaFile, isEmptyFile, isDataBuilding } from '@/utils/fileKind';

// Lenient on purpose, so a fixture omitting fields these helpers never read
// still satisfies them structurally.
export interface FileLike {
  type?: string;
  name?: string;
  extension?: string;
  lines?: number;
  size?: number;
  [k: string]: unknown;
}
export interface DirLike {
  type?: string;
  name?: string;
  path?: string;
  children?: TreeLike[];
  descendants_count?: number;
  children_count?: number;
  [k: string]: unknown;
}
export type TreeLike = FileLike | DirLike;

// The widest tier whose min_descendants the count meets; the last tier is the
// catch-all for big directories.
export function getStreetWidth(count: number, tiers: StreetTier[]): number {
  const arr = tiers;
  let chosen = arr[0].width;
  for (let i = 0; i < arr.length; i++) {
    if (count >= arr[i].min_descendants) chosen = arr[i].width;
  }
  return chosen;
}

// SAFE_RANGE — returned whenever stats are absent or degenerate (min=0,max=0).
// Matches the old empty-tree behaviour so the renderer never divides by zero.
const SAFE_RANGE: RangeStat = { min: 1, max: 1 };

function _safeRange(r: RangeStat | undefined): RangeStat {
  if (!r || (r.min === 0 && r.max === 0)) return SAFE_RANGE;
  return r;
}

// The project's own line and byte ranges, off manifest.stats. An empty range
// falls back to {min:1,max:1} rather than dividing by zero.
export function computeFileStats(stats: RepoStats | null | undefined): {
  lines: RangeStat;
  bytes: RangeStat;
} {
  return {
    lines: _safeRange(stats?.lineCountRange),
    bytes: _safeRange(stats?.byteSizeRange),
  };
}

// Project-relative, but the ceiling is anchored to the biggest file's ABSOLUTE
// size: a repo of small files reads as a short city, not a full one.
type Dims = BuildingDimensionsConfig;

/** Floors from line count, sqrt-normalized. Full cap only when the largest file
 *  is >= FULL_HEIGHT_LINES, so a small-file repo reads low-rise; order preserved. */
function floorsForLines(
  fileLines: number | null | undefined,
  lineStats: RangeStat | undefined,
  dims: Dims,
  maxFloorsCap: number
): number {
  if (!lineStats || lineStats.max <= lineStats.min) return dims.MIN_FLOORS;
  const lines = fileLines && fileLines > 0 ? fileLines : 1;
  const sMin = Math.sqrt(lineStats.min);
  const sMax = Math.sqrt(lineStats.max);
  let tH = (Math.sqrt(lines) - sMin) / (sMax - sMin);
  if (tH < 0) tH = 0;
  else if (tH > 1) tH = 1;

  const refLines =
    dims.FULL_HEIGHT_LINES && dims.FULL_HEIGHT_LINES > 0 ? dims.FULL_HEIGHT_LINES : 2000;
  let ceilH = Math.sqrt(lineStats.max) / Math.sqrt(refLines);
  if (ceilH > 1) ceilH = 1;

  const repoMaxFloors = dims.MIN_FLOORS + ceilH * (maxFloorsCap - dims.MIN_FLOORS);
  const floors = Math.round(dims.MIN_FLOORS + tH * (repoMaxFloors - dims.MIN_FLOORS));
  return floors < dims.MIN_FLOORS ? dims.MIN_FLOORS : floors;
}

/** Width from byte size, log-normalized; full width only past FULL_WIDTH_KB.
 *  Range and size clamp >= 1: log(0) would carry NaN into every dimension. */
function widthForBytes(
  fileSize: number | null | undefined,
  byteStats: RangeStat | undefined,
  dims: Dims
): number {
  const bMin = Math.max(1, byteStats?.min ?? 1);
  const bMax = Math.max(1, byteStats?.max ?? 1);
  if (!byteStats || bMax <= bMin) return dims.MIN_WIDTH;

  const bytes = fileSize && fileSize > 0 ? fileSize : 1;
  const lMin = Math.log(bMin);
  let tW = (Math.log(bytes) - lMin) / (Math.log(bMax) - lMin);
  if (tW < 0) tW = 0;
  else if (tW > 1) tW = 1;

  const refBytes = (dims.FULL_WIDTH_KB && dims.FULL_WIDTH_KB > 0 ? dims.FULL_WIDTH_KB : 64) * 1024;
  let ceilW = Math.log(bMax) / Math.log(refBytes);
  if (ceilW < 0) ceilW = 0;
  else if (ceilW > 1) ceilW = 1;

  const repoMaxWidth = dims.MIN_WIDTH + ceilW * (dims.MAX_WIDTH - dims.MIN_WIDTH);
  return dims.MIN_WIDTH + tW * (repoMaxWidth - dims.MIN_WIDTH);
}

export function getBuildingDimensions(
  file: {
    lines?: number | null;
    size?: number | null;
    extension?: string;
    mediaKind?: 'image' | 'video' | null;
    media_width?: number;
    media_height?: number;
    binary?: boolean;
  },
  dims: Dims,
  lineStats?: RangeStat,
  byteStats?: RangeStat
): { w: number; d: number; h: number; floors: number } {
  const maxFloorsCap = dims.MAX_FLOORS != null ? dims.MAX_FLOORS : 30;

  // MIN_FLOORS is the floor for files that HAVE content, so an empty file skips
  // the whole floors curve and takes the slab branch below instead.
  const empty = isEmptyFile(file);

  const floors = empty
    ? dims.MIN_FLOORS
    : floorsForLines(file.lines, lineStats, dims, maxFloorsCap);
  const height = floors * dims.FLOOR_HEIGHT;

  const width = widthForBytes(file.size, byteStats, dims);

  // Media takes its silhouette from the image's aspect instead of its lines.
  // Height still snaps to whole floors, or the window tiling breaks.
  let h = height;
  let outFloors = floors;
  if (empty) {
    // Nothing to stack: a flat slab at the file's footprint. First branch, so a
    // 0-byte image or blob slabs too rather than taking its kind's sizing.
    outFloors = 0;
    h = dims.EMPTY_SLAB_FLOORS * dims.FLOOR_HEIGHT;
  } else if (isMediaFile(file)) {
    const mw = file.media_width;
    const mh = file.media_height;
    const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
    const aspect = Math.min(2.5, Math.max(0.4, rawAspect));
    const rawHeight = width * aspect;
    outFloors = Math.max(dims.MIN_FLOORS, Math.round(rawHeight / dims.FLOOR_HEIGHT));
    h = outFloors * dims.FLOOR_HEIGHT;
  } else if (isDataBuilding(file)) {
    // Height from bytes (via width), not lines, so a data block is byte-sized
    // both ways instead of the lines-driven MIN_FLOORS stub.
    const rawHeight = width * dims.DATA_HEIGHT_RATIO;
    outFloors = Math.max(dims.MIN_FLOORS, Math.round(rawHeight / dims.FLOOR_HEIGHT));
    h = outFloors * dims.FLOOR_HEIGHT;
  }

  // Depth == width keeps footprints square so tall thin towers don't
  // become deep slabs.
  return {
    w: Math.round(width * 10) / 10,
    d: Math.round(width * 10) / 10,
    h: Math.round(h * 10) / 10,
    floors: outFloors,
  };
}

// Enough project-wide stats to re-derive one building's dimensions without
// re-running the layout.
export interface HeightContext {
  lineStats: RangeStat;
  byteStats: RangeStat;
}

// computeFileStats with a named return type, so call sites read for themselves.
export function makeHeightContext(stats: RepoStats | null | undefined): HeightContext {
  const fs = computeFileStats(stats);
  return { lineStats: fs.lines, byteStats: fs.bytes };
}

// One building's dimensions from the context, for the pass that turns a cached
// layout's skeleton-era placeholders into the final manifest's real sizes.
export function recomputeBuildingDimensions(
  file: FileLike,
  ctx: HeightContext,
  dims: Dims
): { w: number; d: number; h: number; floors: number } {
  return getBuildingDimensions(file, dims, ctx.lineStats, ctx.byteStats);
}

// A directory's descendants → its street width: bigger dirs, wider boulevards.
export function _streetWidthForDir(dir: DirLike | null | undefined, tiers: StreetTier[]): number {
  const count = (dir && (dir.descendants_count || dir.children_count)) || 0;
  return getStreetWidth(count, tiers);
}
