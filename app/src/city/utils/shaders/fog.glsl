// Ground haze — height fog, dense near y=0 and thinning with altitude.
// Driven by SCENE.FOG_* in @/state/stores/settings/scene.ts.
//
// uFogHeightFrac is the fraction of the caller's reference height the haze
// covers, reaching exactly zero at the top of it. Buildings pass their own
// height, so a 2-floor stub and a 60-floor tower wear the same relative skirt.

uniform bool uFogEnabled;
uniform vec3 uFogColor;
uniform float uFogIntensity;
uniform float uFogHeightFrac;

vec3 applyFog(vec3 color, vec3 worldPos, float refHeight) {
  vec3 c = color;
  if (uFogEnabled) {
    // Ramp rather than exponential decay: an exponential piles its visual
    // weight into the lowest few percent, so the slider barely read.
    float t = clamp(worldPos.y / max(uFogHeightFrac * refHeight, 0.001), 0.0, 1.0);
    float h = 1.0 - smoothstep(0.0, 1.0, t);
    c = mix(c, uFogColor, h * uFogIntensity);
  }
  return c;
}
