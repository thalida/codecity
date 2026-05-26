// ringText.frag.glsl — Ring text + glow shader. Shared by the Ring
// style (Task 4) and the Concentric style's outer ring (Task 6).
//
// Samples the monochrome text canvas along the torus's U coordinate
// (scrolled by uTime * uSpinSpeed) and applies a cyan→magenta gradient
// driven by U. A V-falloff term widens the lit band beyond the
// strict text bounding strip so the glow bleeds past the letters.
//
// Output is additive: alpha = text_alpha * uOpacity + glow_falloff * 0.4 * uOpacity.

varying vec2 vUv;

uniform sampler2D uMap;
uniform float uTime;
uniform float uSpinSpeed;
uniform float uOpacity;

void main() {
  // Scroll U with time. fract() handles the wrap so the texture
  // sampler stays in [0,1) regardless of how many turns have elapsed.
  float u = fract(vUv.x + uTime * uSpinSpeed);
  vec4 sampled = texture2D(uMap, vec2(u, vUv.y));
  float textAlpha = sampled.a;

  // Color gradient — cyan at u=0, magenta at u=1, smooth across.
  vec3 cyan = vec3(0.2, 1.0, 1.0);
  vec3 magenta = vec3(1.0, 0.2, 0.9);
  vec3 baseColor = mix(cyan, magenta, u);

  // Glow falloff: 1.0 at the strip centerline (v=0.5), 0 at the rim.
  float glowFalloff = 1.0 - abs(vUv.y - 0.5) * 2.0;
  glowFalloff = max(glowFalloff, 0.0);

  float outAlpha = textAlpha * uOpacity + glowFalloff * 0.4 * uOpacity;
  vec3 outColor = baseColor * (textAlpha + glowFalloff * 0.6);

  gl_FragColor = vec4(outColor, outAlpha);
}
