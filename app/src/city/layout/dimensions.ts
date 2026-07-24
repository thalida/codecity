// city/layout/dimensions.ts — file/building sizing and street width derivation.
// Pure functions over manifest stats and settings stores; no DOM or Three.js.

import { STREET_TIERS } from '@/state/stores/settings/streets';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import type { StreetTier } from '@/state/stores/settings/streets';
import type { RangeStat, RepoStats } from '@/types';
import { isMediaFile } from '../utils/mediaKind';
import { isEmptyFile } from '../utils/emptyKind';

// Structural shapes — kept lenient so test fixtures (which omit fields the
// helpers don't read, like name/path on intermediate nodes) stay
// compatible. Real callers pass full Manifest / TreeNode / FileNode
// instances which structurally satisfy these.
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

// getStreetWidth(count, tiers?) -> number
//
// Given a descendant count and (optionally) a tier list, return the
// world-unit street width. The tier list defaults to STREET_TIERS.get().
// Each tier entry is { min_descendants, width }. Walk the list and pick
// the tier with the highest min_descendants that `count` meets. The last
// tier (largest min_descendants) acts as the catch-all for big directories.
export function getStreetWidth(count: number, tiers?: StreetTier[]): number {
  const arr = tiers && tiers.length ? tiers : STREET_TIERS.value.TIERS;
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

// computeFileStats(stats?) -> { lines: { min, max }, bytes: { min, max } }
//
// Returns the project's own line-count and byte-size ranges read directly
// from the backend-pre-computed manifest.stats (no tree walk). Both ranges
// are needed up front so every building can be normalised into the project's
// actual range (smallest → MIN_*, largest → MAX_*).
//
// When stats is absent or a range is the empty sentinel {min:0,max:0}
// (EMPTY_REPO_STATS), falls back to {min:1,max:1} so the renderer never
// divides by zero — matching the old empty-tree behaviour exactly.
export function computeFileStats(stats: RepoStats | null | undefined): {
  lines: RangeStat;
  bytes: RangeStat;
} {
  return {
    lines: _safeRange(stats?.lineCountRange),
    bytes: _safeRange(stats?.byteSizeRange),
  };
}

// An empty file's slab height, in floors. Small enough to read as ground, tall
// enough to raycast; expressed in floors so it scales with FLOOR_HEIGHT.
export const EMPTY_SLAB_FLOORS = 0.05;

// getBuildingDimensions(file, lineStats?, byteStats?) -> { w, d, h, floors }
//
// Floors and width are project-relative: the smallest file lands at MIN_*, and
// the range is spread by sqrt (lines) / log (bytes) so the bottom of the range
// reads clearly while the long tail compresses. The TOP of the range is a
// per-repo ceiling anchored to the ABSOLUTE size of the biggest file
// (FULL_HEIGHT_LINES / FULL_WIDTH_KB): a repo whose largest file is small tops
// out below MAX_* (short/narrow city) instead of always stretching to the cap,
// while the per-repo relative order is retained. Without a stats object, the
// corresponding dimension falls back to MIN_*.
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
  lineStats?: RangeStat,
  byteStats?: RangeStat
): { w: number; d: number; h: number; floors: number } {
  const dims = BUILDING_DIMENSIONS.value;
  const maxFloorsCap = dims.MAX_FLOORS != null ? dims.MAX_FLOORS : 30;

  // MIN_FLOORS is the floor for files that HAVE content, so an empty file skips
  // the whole floors curve and takes the slab branch below instead.
  const empty = isEmptyFile(file);

  // ---- Floors from line count (sqrt-normalized over project range) ----
  const lines = file.lines && file.lines > 0 ? file.lines : 1;
  let floors = dims.MIN_FLOORS;
  if (!empty && lineStats && lineStats.max > lineStats.min) {
    const sMin = Math.sqrt(lineStats.min);
    const sMax = Math.sqrt(lineStats.max);
    const sLines = Math.sqrt(lines);
    let tH = (sLines - sMin) / (sMax - sMin);
    if (tH < 0) tH = 0;
    else if (tH > 1) tH = 1;
    // Absolute ceiling: the repo's tallest building reaches the full cap only if
    // its largest file is >= FULL_HEIGHT_LINES; smaller-file repos top out lower
    // (sqrt of the biggest file vs the reference). So the per-repo relative
    // spread (tH) is preserved, but a repo of tiny files reads as a low-rise
    // city instead of being stretched to full height.
    const refLines =
      dims.FULL_HEIGHT_LINES && dims.FULL_HEIGHT_LINES > 0 ? dims.FULL_HEIGHT_LINES : 2000;
    let ceilH = Math.sqrt(lineStats.max) / Math.sqrt(refLines);
    if (ceilH > 1) ceilH = 1;
    const repoMaxFloors = dims.MIN_FLOORS + ceilH * (maxFloorsCap - dims.MIN_FLOORS);
    floors = Math.round(dims.MIN_FLOORS + tH * (repoMaxFloors - dims.MIN_FLOORS));
    if (floors < dims.MIN_FLOORS) floors = dims.MIN_FLOORS;
  }
  const height = floors * dims.FLOOR_HEIGHT;

  // ---- Width from byte size (log-normalized over project range) ----
  const bytes = file.size && file.size > 0 ? file.size : 1;
  let width = dims.MIN_WIDTH;
  // Clamp the range to >= 1 so Math.log stays finite even if the project byte
  // range ever includes a 0-byte file (log(0) = -Infinity → NaN width → NaN
  // geometry). Per-file `bytes` is already clamped to >= 1 above.
  const bMin = Math.max(1, byteStats?.min ?? 1);
  const bMax = Math.max(1, byteStats?.max ?? 1);
  if (byteStats && bMax > bMin) {
    const lMin = Math.log(bMin);
    const lMax = Math.log(bMax);
    const lBytes = Math.log(bytes);
    let tW = (lBytes - lMin) / (lMax - lMin);
    if (tW < 0) tW = 0;
    else if (tW > 1) tW = 1;
    // Absolute ceiling mirrors floors: full width only when the repo's largest
    // file is >= FULL_WIDTH_KB; smaller-file repos keep proportionally narrower
    // footprints while retaining the per-repo relative spread (tW).
    const refBytes =
      (dims.FULL_WIDTH_KB && dims.FULL_WIDTH_KB > 0 ? dims.FULL_WIDTH_KB : 64) * 1024;
    let ceilW = Math.log(bMax) / Math.log(refBytes);
    if (ceilW < 0) ceilW = 0;
    else if (ceilW > 1) ceilW = 1;
    const repoMaxWidth = dims.MIN_WIDTH + ceilW * (dims.MAX_WIDTH - dims.MIN_WIDTH);
    width = dims.MIN_WIDTH + tW * (repoMaxWidth - dims.MIN_WIDTH);
  }

  // Media files (image/video) override the lines-driven height: the
  // building's silhouette mirrors the image's natural aspect ratio
  // instead. Width still comes from bytes; height snaps to a whole-
  // floor count so the facade shader's window tiling stays consistent
  // with regular buildings. Missing dims → 1:1 aspect (square fallback).
  let h = height;
  let outFloors = floors;
  if (empty) {
    // Nothing to stack: a flat slab at the file's footprint. First branch, so a
    // 0-byte image or blob slabs too rather than taking its kind's sizing.
    outFloors = 0;
    h = EMPTY_SLAB_FLOORS * dims.FLOOR_HEIGHT;
  } else if (isMediaFile(file)) {
    const mw = file.media_width;
    const mh = file.media_height;
    const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
    const aspect = Math.min(2.5, Math.max(0.4, rawAspect));
    const rawHeight = width * aspect;
    outFloors = Math.max(dims.MIN_FLOORS, Math.round(rawHeight / dims.FLOOR_HEIGHT));
    h = outFloors * dims.FLOOR_HEIGHT;
  } else if (file.binary) {
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

// HeightContext — project-wide stats needed to reproduce getBuildingDimensions
// for a single file without re-running the full layout. Derive it once from
// the new manifest's tree via makeHeightContext(), then pass to
// recomputeBuildingDimensions() for each building in Phase 2.
export interface HeightContext {
  lineStats: RangeStat;
  byteStats: RangeStat;
}

// makeHeightContext(stats?) → HeightContext
//
// Returns the project-wide line + byte ranges needed by
// recomputeBuildingDimensions, read from the pre-computed manifest.stats.
// Thin wrapper over computeFileStats with a named return type so call sites
// are self-documenting.
export function makeHeightContext(stats: RepoStats | null | undefined): HeightContext {
  const fs = computeFileStats(stats);
  return { lineStats: fs.lines, byteStats: fs.bytes };
}

// recomputeBuildingDimensions(file, ctx) → { w, d, h, floors }
//
// Re-derives a single building's dimensions (height, footprint, floor count)
// from its FileNode and the project-wide HeightContext. Delegates to
// getBuildingDimensions with the context stats unpacked.
//
// Use this in Phase 2 of applyManifest so that the cached layout (which holds
// skeleton-era placeholder dimensions) is updated to reflect the final
// manifest's real per-file sizes and line counts.
export function recomputeBuildingDimensions(
  file: FileLike,
  ctx: HeightContext
): { w: number; d: number; h: number; floors: number } {
  return getBuildingDimensions(file, ctx.lineStats, ctx.byteStats);
}

// buildingHeightForLines(file, lines, ctx) → number
//
// The scene-Y height a building would have at a given line count, reusing the
// exact getBuildingDimensions curve (sqrt-normalized floors × FLOOR_HEIGHT).
// Timeline scrub recomputes this per frame from the file's replayed line count.
// Media files ignore lines (height comes from aspect), so this returns their
// constant height regardless.
export function buildingHeightForLines(
  file: Parameters<typeof getBuildingDimensions>[0],
  lines: number,
  ctx: HeightContext
): number {
  return getBuildingDimensions({ ...file, lines }, ctx.lineStats, ctx.byteStats).h;
}

// -----------------------------------------------------------------------------
// _streetWidthForDir(dir) -> number
//
// Maps a directory's descendants to a tier and returns the visual width of
// its street. Larger directories get wider boulevards.
// -----------------------------------------------------------------------------
export function _streetWidthForDir(dir: DirLike | null | undefined): number {
  const count = (dir && (dir.descendants_count || dir.children_count)) || 0;
  return getStreetWidth(count, STREET_TIERS.value.TIERS);
}
