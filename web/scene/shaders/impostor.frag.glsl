// impostor.frag.glsl — Mid-distance LOD tier. The base color (iColor)
// arrives as linear-sRGB from Three.js Color.set() — same convention
// as the detail facade shader. We:
//   1. Convert linear → sRGB so the building color (which already
//      encodes modifiedAge via HSL saturation/lightness from
//      getBuildingColor) reads with the same intensity it does on the
//      detail tier.
//   2. Apply the same directional sun + ambient lighting the detail
//      shader uses, so face shading is consistent across tier swaps.
//   3. Apply the same height-based ground haze the detail shader does,
//      so building bases fade into the mist (otherwise impostors look
//      uniformly bright and "floating" compared to the grounded detail
//      tier). Mirrors the fog code at the bottom of building.frag.glsl.
// No per-cell window/door/grime math — impostors stay cheap.

#include <hsl_glsl_inline>

precision mediump float;

varying vec3 vColor;
varying float vFade;
varying vec3 vWorldNormal;
varying float vWorldY;

uniform vec3 uSunDirWorld;
uniform float uAmbient;
uniform float uSunContrast;
uniform vec3 uFogColor;
uniform float uFogIntensity;
uniform float uFogHeight;

void main() {
  vec3 baseColor = linearToSrgb(vColor);
  float lambert = max(dot(normalize(vWorldNormal), uSunDirWorld), 0.0);
  float lightFactor = uAmbient + uSunContrast * lambert;
  vec3 color = baseColor * lightFactor;

  // Ground haze — exponential height-based fog. Building bases sit in
  // mist; tops poke into clean air. Camera distance doesn't affect this.
  float h = max(vWorldY, 0.0);
  float fogAmount = exp(-h / max(uFogHeight, 0.0001)) * uFogIntensity;
  color = mix(color, uFogColor, fogAmount);

  gl_FragColor = vec4(color, vFade);
}
