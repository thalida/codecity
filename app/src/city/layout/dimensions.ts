// city/layout/dimensions.ts — file/building sizing and street width derivation.
// Pure functions over manifest stats and settings stores; no DOM or Three.js.

import { STREET_TIERS } from '@/state/stores/settings/streets';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import type { StreetTier } from '@/state/stores/settings/streets';
import type { RangeStat, RepoStats } from '@/types';
import { isMediaFile } from '../utils/mediaKind';

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
    lines: _safeRange(stats?.fileLines),
    bytes: _safeRange(stats?.fileBytes),
  };
}

// computeLineStats(stats?) — kept for back-compat with tests that only need
// the line-count range. New callers should use computeFileStats.
export function computeLineStats(stats: RepoStats | null | undefined): RangeStat {
  return computeFileStats(stats).lines;
}

// getBuildingDimensions(file, lineStats?, byteStats?) -> { w, d, h, floors }
//
// Floors and width are BOTH project-relative: the smallest file lands at
// MIN_*, the largest at MAX_*, everything else interpolated. Floors uses
// sqrt to spread the bottom of the range while compressing the long tail;
// width uses log (file sizes span many orders of magnitude). Without a
// stats object, the corresponding dimension falls back to MIN_*.
export function getBuildingDimensions(
  file: {
    lines?: number | null;
    size?: number | null;
    extension?: string;
    mediaKind?: 'image' | 'video' | null;
    media_width?: number;
    media_height?: number;
  },
  lineStats?: RangeStat,
  byteStats?: RangeStat
): { w: number; d: number; h: number; floors: number } {
  const dims = BUILDING_DIMENSIONS.value;
  const maxFloorsCap = dims.MAX_FLOORS != null ? dims.MAX_FLOORS : 30;

  // ---- Floors from line count (sqrt-normalized over project range) ----
  const lines = file.lines && file.lines > 0 ? file.lines : 1;
  let floors = dims.MIN_FLOORS;
  if (lineStats && lineStats.max > lineStats.min) {
    const sMin = Math.sqrt(lineStats.min);
    const sMax = Math.sqrt(lineStats.max);
    const sLines = Math.sqrt(lines);
    let tH = (sLines - sMin) / (sMax - sMin);
    if (tH < 0) tH = 0;
    else if (tH > 1) tH = 1;
    floors = Math.round(dims.MIN_FLOORS + tH * (maxFloorsCap - dims.MIN_FLOORS));
    if (floors < dims.MIN_FLOORS) floors = dims.MIN_FLOORS;
  }
  const height = floors * dims.FLOOR_HEIGHT;

  // ---- Width from byte size (log-normalized over project range) ----
  const bytes = file.size && file.size > 0 ? file.size : 1;
  let width = dims.MIN_WIDTH;
  if (byteStats && byteStats.max > byteStats.min) {
    const lMin = Math.log(byteStats.min);
    const lMax = Math.log(byteStats.max);
    const lBytes = Math.log(bytes);
    let tW = (lBytes - lMin) / (lMax - lMin);
    if (tW < 0) tW = 0;
    else if (tW > 1) tW = 1;
    width = dims.MIN_WIDTH + tW * (dims.MAX_WIDTH - dims.MIN_WIDTH);
  }

  // Media files (image/video) override the lines-driven height: the
  // building's silhouette mirrors the image's natural aspect ratio
  // instead. Width still comes from bytes; height snaps to a whole-
  // floor count so the facade shader's window tiling stays consistent
  // with regular buildings. Missing dims → 1:1 aspect (square fallback).
  let h = height;
  let mediaFloors = floors;
  if (isMediaFile(file)) {
    const mw = file.media_width;
    const mh = file.media_height;
    const rawAspect = mw && mh && mw > 0 ? mh / mw : 1.0;
    const aspect = Math.min(2.5, Math.max(0.4, rawAspect));
    const rawHeight = width * aspect;
    mediaFloors = Math.max(dims.MIN_FLOORS, Math.round(rawHeight / dims.FLOOR_HEIGHT));
    h = mediaFloors * dims.FLOOR_HEIGHT;
  }

  // Depth == width keeps footprints square so tall thin towers don't
  // become deep slabs.
  return {
    w: Math.round(width * 10) / 10,
    d: Math.round(width * 10) / 10,
    h: Math.round(h * 10) / 10,
    floors: mediaFloors,
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
