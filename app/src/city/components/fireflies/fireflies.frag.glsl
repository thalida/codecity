// fireflies.frag.glsl — soft round glow per point, then the brightness
// pipeline: instance color × pulse × flicker × emission × hover/select boost.

#define HOVER_BRIGHTNESS_BOOST 3.0
#define SELECT_BRIGHTNESS_BOOST 6.0
#define FLICKER_HZ 8.0

uniform float uTime;
uniform float uEmission;
uniform float uFlicker;
uniform float uHoveredCommit;
uniform float uSelectedCommit;

varying float vPulse;
varying float vCommitIndex;
varying vec3 vInstanceColor;

#include <hash_glsl_inline>

void main() {
  // Round soft-glow footprint inside the point square: bright core,
  // feathered rim (replaces the old icosphere silhouette).
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(pc, pc);
  if (r2 > 1.0) discard;
  float glow = 1.0 - r2;
  glow *= glow;

  // Flicker: hold each random value for ~1/8 second so the brain reads
  // it as flicker rather than integrating to a steady average. Above
  // ~30 Hz the eye smooths it out.
  float noiseStep = floor(uTime * FLICKER_HZ);
  float flickerNoise = hash11(noiseStep * 17.0 + vCommitIndex * 13.0);
  float flicker = mix(1.0, flickerNoise, uFlicker);

  // Hover / select brightness. Select beats hover.
  float boost = 1.0;
  if (uSelectedCommit >= 0.0 && abs(vCommitIndex - uSelectedCommit) < 0.5) {
    boost = SELECT_BRIGHTNESS_BOOST;
  } else if (uHoveredCommit >= 0.0 && abs(vCommitIndex - uHoveredCommit) < 0.5) {
    boost = HOVER_BRIGHTNESS_BOOST;
  }

  vec3 color = vInstanceColor * vPulse * flicker * uEmission * boost * glow;
  gl_FragColor = vec4(color, 1.0);
}
