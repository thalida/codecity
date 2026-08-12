// fireflies.frag.glsl — composes the brightness pipeline:
//   instanceColor × pulse × flicker × emission × hover/select boost
//   + additive rim outline on hover/select.

// Compile-time constants matching the renderer.
#define HOVER_BRIGHTNESS_BOOST 3.0
#define SELECT_BRIGHTNESS_BOOST 6.0
#define HOVER_RIM_STRENGTH 1.5
#define SELECT_RIM_STRENGTH 3.0
#define FLICKER_HZ 8.0

uniform float uTime;
uniform float uEmission;
uniform float uFlicker;
uniform float uHoveredCommit;
uniform float uSelectedCommit;

varying float vPulse;
varying float vCommitIndex;
varying vec3 vViewNormal;
varying vec3 vInstanceColor;

#include <hash_glsl_inline>

void main() {
  // Flicker: hold each random value for ~1/8 second so the brain reads
  // it as flicker rather than integrating to a steady average. Above
  // ~30 Hz the eye smooths it out.
  float noiseStep = floor(uTime * FLICKER_HZ);
  float flickerNoise = hash11(noiseStep * 17.0 + vCommitIndex * 13.0);
  float flicker = mix(1.0, flickerNoise, uFlicker);

  // Hover / select brightness + rim. Select beats hover.
  float boost = 1.0;
  float rimStrength = 0.0;
  if (uSelectedCommit >= 0.0 && abs(vCommitIndex - uSelectedCommit) < 0.5) {
    boost = SELECT_BRIGHTNESS_BOOST;
    rimStrength = SELECT_RIM_STRENGTH;
  } else if (uHoveredCommit >= 0.0 && abs(vCommitIndex - uHoveredCommit) < 0.5) {
    boost = HOVER_BRIGHTNESS_BOOST;
    rimStrength = HOVER_RIM_STRENGTH;
  }

  // Rim outline — silhouette edges glow brighter when highlighted.
  // view-space normal.z component points toward the camera; 1 at center,
  // 0 at silhouette. Inverted + pow gives a sharp edge glow.
  float rim = 1.0 - abs(vViewNormal.z);
  rim = pow(rim, 2.0);

  vec3 color = vInstanceColor * vPulse * flicker * uEmission * boost;
  color += rim * rimStrength;

  gl_FragColor = vec4(color, 1.0);
}
