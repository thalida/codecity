// city/utils/shaders/fogChunk.ts — Shared GLSL fog snippet for the island,
// buildings, and any other shader that wants atmospheric depth.
//
// Height fog: dense near y=0, thinning with altitude. Driven by
//   SCENE.FOG_* in @/state/stores/settings/scene.ts. Buildings and the island consume this.
//
// This module exports ONLY the GLSL strings. Each consumer wires its
// own uniforms — we don't centralize uniform defaults here because
// height fog (uFogHeight) is dynamically derived from BUILDING_DIMENSIONS
// in buildings.ts, and forcing a single defaults helper would couple the
// chunk to that derivation.

export const FOG_UNIFORMS_GLSL = /* glsl */ `
uniform bool uFogEnabled;
uniform vec3 uFogColor;
uniform float uFogIntensity;
uniform float uFogHeight;
`;

export const FOG_APPLY_GLSL = /* glsl */ `
vec3 applyFog(vec3 color, vec3 worldPos) {
  vec3 c = color;
  if (uFogEnabled) {
    float h = exp(-max(worldPos.y, 0.0) / max(uFogHeight, 0.001));
    c = mix(c, uFogColor, h * uFogIntensity);
  }
  return c;
}
`;
