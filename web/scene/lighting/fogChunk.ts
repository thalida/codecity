// scene/lighting/fogChunk.ts — Shared GLSL fog snippet for the island,
// buildings, and any other shader that wants atmospheric depth.
//
// Two modes, additive:
//   Height fog: dense near y=0, thinning with altitude. Driven by
//     SCENE_COLORS.FOG_* in @/config/view.js. Buildings consume this.
//   Distance fog: fades by view distance. Driven by
//     ISLAND_ATMOSPHERE.DISTANCE_FOG_* in @/config/island.js. Island
//     consumes this exclusively (it has no "ground" of its own).
//     Buildings get both.
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

uniform bool uDistanceFogEnabled;
uniform vec3 uDistanceFogColor;
uniform float uDistanceFogNear;
uniform float uDistanceFogFar;
`;

export const FOG_APPLY_GLSL = /* glsl */ `
vec3 applyFog(vec3 color, vec3 worldPos, float viewDist) {
  vec3 c = color;
  if (uFogEnabled) {
    float h = exp(-max(worldPos.y, 0.0) / max(uFogHeight, 0.001));
    c = mix(c, uFogColor, h * uFogIntensity);
  }
  if (uDistanceFogEnabled) {
    float t = smoothstep(uDistanceFogNear, uDistanceFogFar, viewDist);
    c = mix(c, uDistanceFogColor, t);
  }
  return c;
}
`;
