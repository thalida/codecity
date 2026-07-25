// city/utils/shaders/fogChunk.ts — Shared GLSL fog snippet for the island,
// buildings, and any other shader that wants atmospheric depth.
//
// Height fog: dense near y=0, thinning with altitude. Driven by
//   SCENE.FOG_* in @/state/stores/settings/scene.ts. Buildings and the island consume this.
//
// The falloff height is relative: uFogHeightFrac is the raw
// SCENE.FOG_HEIGHT_FRAC and each call site passes the height it wants the
// fraction measured against. Buildings pass their own, so a 2-floor stub and
// a 60-floor tower wear the same relative skirt.
//
// This module exports ONLY the GLSL strings — each consumer wires its own
// uniforms.

export const FOG_UNIFORMS_GLSL = /* glsl */ `
uniform bool uFogEnabled;
uniform vec3 uFogColor;
uniform float uFogIntensity;
uniform float uFogHeightFrac;
`;

export const FOG_APPLY_GLSL = /* glsl */ `
vec3 applyFog(vec3 color, vec3 worldPos, float refHeight) {
  vec3 c = color;
  if (uFogEnabled) {
    float h = exp(-max(worldPos.y, 0.0) / max(uFogHeightFrac * refHeight, 0.001));
    c = mix(c, uFogColor, h * uFogIntensity);
  }
  return c;
}
`;
