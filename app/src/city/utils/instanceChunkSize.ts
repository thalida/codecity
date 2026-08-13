// city/utils/instanceChunkSize.ts — trees per chunk mesh for the big scatter
// draws. Spatially-grouped chunks are what make per-chunk frustum culling
// drop off-screen forest; the size is a memory/draw-count balance.

import { URL_PARAMS } from '@/constants/urlParams';

const DEFAULT_INSTANCE_CHUNK = 512;

/** Trees per chunk mesh; ?chunk=<n> overrides for on-device probing. */
export function instanceChunkSize(): number {
  if (typeof window === 'undefined') return DEFAULT_INSTANCE_CHUNK;
  const raw = Number(new URLSearchParams(window.location.search).get(URL_PARAMS.CHUNK) ?? NaN);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_INSTANCE_CHUNK;
}
