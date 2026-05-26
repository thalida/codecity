// innerRing.frag.glsl — Decorative inner ring for the Concentric
// style. Dashed cyan glow, no text.

varying vec2 vUv;

uniform float uOpacity;

void main() {
  // Dashed pattern around the ring's U axis: 32 dashes, 50% duty cycle.
  float dash = step(0.5, fract(vUv.x * 32.0));

  // V falloff so the dash has a glow edge, same shape as the outer ring's.
  float glowFalloff = max(1.0 - abs(vUv.y - 0.5) * 2.0, 0.0);

  vec3 cyan = vec3(0.4, 1.0, 1.0);
  float alpha = (dash * 0.6 + glowFalloff * 0.4) * uOpacity;
  gl_FragColor = vec4(cyan * (dash + glowFalloff * 0.5), alpha);
}
