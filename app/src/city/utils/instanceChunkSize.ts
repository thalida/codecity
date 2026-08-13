// city/utils/instanceChunkSize.ts — trees per chunk mesh. Spatial chunks are
// what let frustum culling drop off-screen forest; the size trades draw calls
// against how much a single cull decision covers.

export const TREES_PER_CHUNK = 512;
