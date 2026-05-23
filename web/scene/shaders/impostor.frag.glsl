// impostor.frag.glsl — Mid-distance LOD tier. The base color (iColor)
// arrives as linear-sRGB from Three.js Color.set() — same convention
// as the detail facade shader. We:
//   1. Convert linear → sRGB so the building color (which already
//      encodes modifiedAge via HSL saturation/lightness from
//      getBuildingColor) reads with the same intensity it does on the
//      detail tier.
//   2. Apply the same directional sun + ambient lighting the detail
//      shader uses, so face shading is consistent across tier swaps.
//   3. Apply the same height fog + optional distance fog the detail
//      shader does via the shared fog chunk, so impostors fade
//      consistently and don't pop when the LOD swaps.
// No per-cell window/door/grime math — impostors stay cheap.

#include <hsl_glsl_inline>
#include <fog_uniforms_glsl_inline>

precision mediump float;

varying vec3 vColor;
varying float vFade;
varying vec3 vWorldNormal;
varying float vWorldY;
varying vec3 vWorldPos;

uniform vec3 uSunDirWorld;
uniform float uAmbient;
uniform float uSunContrast;

// Ground haze (height-based) + optional distance fog.
// Uniforms declared by #include <fog_uniforms_glsl_inline> above.
// Both consumed via applyFog() below.

#include <fog_apply_glsl_inline>

void main() {
  vec3 baseColor = linearToSrgb(vColor);
  float lambert = max(dot(normalize(vWorldNormal), uSunDirWorld), 0.0);
  float lightFactor = uAmbient + uSunContrast * lambert;
  vec3 color = baseColor * lightFactor;

  vec4 outColor = vec4(color, vFade);

  // Atmospheric fog: height fog (dense at y=0, thins with altitude) and
  // optional distance fog (fades by view distance). Matches the detail
  // building shader exactly so there's no pop at the LOD boundary.
  // cameraPosition is a Three.js built-in uniform — no explicit declaration needed.
  outColor.rgb = applyFog(outColor.rgb, vWorldPos, length(vWorldPos - cameraPosition));

  gl_FragColor = outColor;
}
