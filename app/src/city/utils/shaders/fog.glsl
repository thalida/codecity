// Ground haze — height fog, dense near y=0 and thinning with altitude.
// Driven by SCENE.FOG_* in @/state/stores/settings/scene.ts.
//
// uFogHeightFrac is the fraction of the caller's reference height the haze
// visibly occupies. Buildings pass their own height, so a 2-floor stub and a
// 60-floor tower wear the same relative skirt.

uniform bool uFogEnabled;
uniform vec3 uFogColor;
uniform float uFogIntensity;
uniform float uFogHeightFrac;

// Exponential fog has no hard ceiling, so "visibly clear" is a convention:
// 4 e-folds leaves 1.8% of the street-level haze, which reads as gone.
const float FOG_CLEAR_EFOLDS = 4.0;

vec3 applyFog(vec3 color, vec3 worldPos, float refHeight) {
  vec3 c = color;
  if (uFogEnabled) {
    float scale = uFogHeightFrac * refHeight / FOG_CLEAR_EFOLDS;
    float h = exp(-max(worldPos.y, 0.0) / max(scale, 0.001));
    c = mix(c, uFogColor, h * uFogIntensity);
  }
  return c;
}
