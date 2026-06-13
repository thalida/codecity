
precision highp float;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying vec3 vWorldPos;
varying float vAO;

uniform vec3 uHemiSkyColor;
uniform vec3 uHemiGroundColor;

#include <fog_uniforms_glsl_inline>
#include <fog_apply_glsl_inline>

void main() {
  vec3 n = normalize(vNormalWorld);

  // Hemispheric model: warm key light from +Y (sky), cool fill from -Y
  // (ground). Blend by normal.y so up-facing surfaces get the sky color,
  // down-facing get the ground color, side-facing gets the gradient.
  // Single coherent lighting model — no sun direction, no additive glow.
  float hemi = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 hemiTint = mix(uHemiGroundColor, uHemiSkyColor, hemi);
  vec3 lit = vColor * hemiTint * vAO;

  vec3 foggy = applyFog(lit, vWorldPos);
  gl_FragColor = vec4(foggy, 1.0);
}
