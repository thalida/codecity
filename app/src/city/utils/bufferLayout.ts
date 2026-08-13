// city/utils/bufferLayout.ts — the strides the renderers index buffers with.
// Named because the bare numbers collide: a vec3's component count and a
// triangle's vertex count are both 3, and mixing them silently mis-indexes.

/** Components in a vec3 attribute (xyz, or rgb). */
export const VEC3_COMPONENTS = 3;

/** Vertices per triangle in a non-indexed triangle list. */
export const VERTS_PER_TRIANGLE = 3;

/** Floats per fat-line segment: start + end, each a vec3. */
export const FLOATS_PER_SEGMENT = VEC3_COMPONENTS * 2;

/** Full value of a uint8-normalized attribute or texel channel. */
export const BYTE_MAX = 255;
