// holoText.frag.glsl — Glitchy holographic text panel.
//
// Samples the monochrome text canvas with RGB-split UV offsets, modulates
// alpha with horizontal scanlines, and adds occasional glitch jitter on
// vUv.x (every 3–5 seconds, ~80ms duration).

varying vec2 vUv;

uniform sampler2D uMap;
uniform float uTime;
uniform float uOpacity;

float hash11(float n) {
  return fract(sin(n) * 43758.5453);
}

void main() {
  // Glitch jitter: derive a slow-clock bucket (0.25 Hz) and check
  // whether the fractional second-of-bucket window is < 0.08 (80ms).
  float bucket = floor(uTime * 0.25);
  float withinBucket = fract(uTime * 0.25) * 4.0; // 0..4 seconds
  float glitchActive = step(withinBucket, 0.08) * step(0.3, hash11(bucket * 7.31));
  float glitchOffset = (hash11(bucket * 3.17) - 0.5) * 0.04 * glitchActive;

  vec2 uv = vUv + vec2(glitchOffset, 0.0);
  float aR = texture2D(uMap, uv + vec2( 0.003, 0.0)).a;
  float aG = texture2D(uMap, uv).a;
  float aB = texture2D(uMap, uv + vec2(-0.003, 0.0)).a;

  // Scanlines — narrow horizontal stripes modulate alpha by ±15%.
  float scan = 0.85 + 0.15 * sin(vUv.y * 60.0 + uTime * 4.0);

  vec3 color = vec3(aR, aG, aB);
  float alpha = max(max(aR, aG), aB) * scan;
  gl_FragColor = vec4(color, alpha * uOpacity);
}
