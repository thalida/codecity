// city/utils/instanceChunkSize.ts — how many instances a single InstancedMesh
// may carry for the big scatter draws (tree canopies/trunks, fireflies).
// One huge instanced draw intermittently renders corrupted instances on some
// mobile drivers (seen on Samsung Xclipse 950 via ANGLE-on-Vulkan: giant
// screen-covering triangles in the mesh's own colors), while the same content
// split into smaller batches draws clean. Buildings never showed it — their
// cells are naturally small batches — which is what pointed at draw size.

import { URL_PARAMS } from '@/constants/urlParams';

const DEFAULT_INSTANCE_CHUNK = 512;

/** Chunk size for instanced scatter draws; ?chunk=<n> overrides for
 *  on-device probing of a driver's corruption threshold. */
export function instanceChunkSize(): number {
  if (typeof window === 'undefined') return DEFAULT_INSTANCE_CHUNK;
  const raw = Number(new URLSearchParams(window.location.search).get(URL_PARAMS.CHUNK) ?? NaN);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_INSTANCE_CHUNK;
}
