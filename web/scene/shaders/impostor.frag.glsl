// impostor.frag.glsl — Mid-distance LOD tier. The base color (iColor)
// arrives as linear-sRGB from Three.js Color.set() — same convention
// as the detail facade shader. We:
//   1. Convert linear → sRGB so the building color (which already
//      encodes modifiedAge via HSL saturation/lightness from
//      getBuildingColor) reads with the same intensity it does on the
//      detail tier.
//   2. Apply the same directional sun + ambient lighting the detail
//      shader uses, so face shading is consistent across tier swaps.
// No per-cell window/door/grime math — impostors stay cheap.

#include <hsl_glsl_inline>

precision mediump float;

varying vec3 vColor;
varying float vFade;
varying vec3 vWorldNormal;

uniform vec3 uSunDirWorld;
uniform float uAmbient;
uniform float uSunContrast;

void main() {
  vec3 baseColor = linearToSrgb(vColor);
  float lambert = max(dot(normalize(vWorldNormal), uSunDirWorld), 0.0);
  float lightFactor = uAmbient + uSunContrast * lambert;
  gl_FragColor = vec4(baseColor * lightFactor, vFade);
}
