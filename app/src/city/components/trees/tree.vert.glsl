// tree.vert.glsl — merged tree chunks: vertices arrive pre-transformed to
// world space with all colors baked per-vertex (see treeRenderer's bake).
// Deliberately no instancing: instanced tree draws corrupt on mobile GPU
// drivers (Samsung Xclipse 950, both browser GL stacks); this is the same
// draw shape as roads, which never glitched. The commit index rides along
// for the timeline scrub gate (fragment discard).

attribute float aCommitIndex;

uniform sampler2D uGrowth;
uniform vec2 uGrowthSize;
uniform float uHalfLifeDays;
uniform float uMinHeight;
uniform float uMaxHeight;
uniform float uNowDay;
uniform float uWidthAgeFloor;

varying vec3 vColor;
varying float vCommitIndex;

#include <hash_glsl_inline>

// Two canopies sharing space have no depth order to speak of, so the buffer
// picks per pixel and the overlap stipples. This gives each tree a fixed place
// in the queue instead: same commit, same nudge, same winner every frame.
//
// In EYE space, in world units. The same nudge in clip space is a constant in
// NDC, and NDC z is nowhere near linear: far from the camera it buys a huge
// distance, enough to pull a distant tree in front of whatever should hide it,
// so trees popped into view while orbiting. Here it's the same small step at
// any distance.
//
// Quantised into rungs rather than taken raw. A raw hash spreads trees
// continuously, so a pair can land a millionth of a unit apart, which the depth
// buffer cannot tell from a tie: most pairs separated by far less than the
// nudge suggests, and the fight came back on whichever pairs drew the short
// straw. On a rung ladder, two trees either share a rung or clear each other by
// a whole step.
//
// The whole ladder stays well under a trunk's width, so it can never reorder
// trees that are genuinely apart. Trees that share a rung still fight: with
// this many rungs that's roughly one overlapping pair in DEPTH_RUNGS.
const float DEPTH_RUNGS = 32.0;
const float DEPTH_RUNG = 0.02;

// Per-tree growth data, keyed by the commit index every vertex already carries.
// A texel rather than more per-vertex attributes, which would repeat one row
// per tree across every vertex. texture2D, not texelFetch: this is GLSL 1.
vec4 growthTexel(float index) {
  float x = mod(index, uGrowthSize.x);
  float y = floor(index / uGrowthSize.x);
  return texture2D(uGrowth, (vec2(x, y) + 0.5) / uGrowthSize);
}

// The same hyperbolic curve as utils/recency: 1 at the moment of the commit,
// approaching 0 and never reaching it, half at HALF_LIFE_DAYS.
float maturityAt(float commitDay, float nowDay) {
  float days = max(0.0, nowDay - commitDay);
  return 1.0 - 1.0 / (1.0 + days / max(1.0, uHalfLifeDays));
}

// treeEncoding's WIDTH_AGE_FLOOR term: a tree only reaches its file-count
// radius at full height, so a sapling is narrow as well as short.
float widthAttenuation(float height) {
  float t = (height - uMinHeight) / max(0.001, uMaxHeight - uMinHeight);
  return uWidthAgeFloor + (1.0 - uWidthAgeFloor) * t;
}

void main() {
  vColor = color;
  vCommitIndex = aCommitIndex;

  // Height and width are baked at the scan date, so scrubbing rescales the tree
  // about its trunk base by the ratio to the size it was on the scrubbed day.
  // Base radius follows file count, a fact about the commit, so it cancels.
  vec4 g = growthTexel(aCommitIndex);
  float commitDay = g.x;
  float bakedHeight = g.w;
  float grownHeight = uMinHeight + maturityAt(commitDay, uNowDay) * (uMaxHeight - uMinHeight);
  // A negative day marks a tree with no commit: no age to scrub through.
  bool grows = commitDay >= 0.0 && bakedHeight > 0.0;
  float heightScale = grows ? grownHeight / bakedHeight : 1.0;
  float widthScale =
    grows ? widthAttenuation(grownHeight) / max(0.0001, widthAttenuation(bakedHeight)) : 1.0;

  // Trunk base: y=0 by construction, so scaling about it keeps the tree planted.
  vec3 center = vec3(g.y, 0.0, g.z);
  vec3 grown = vec3(
    center.x + (position.x - center.x) * widthScale,
    position.y * heightScale,
    center.z + (position.z - center.z) * widthScale
  );

  vec4 eye = modelViewMatrix * vec4(grown, 1.0);
  // The camera looks down -Z in eye space, so +Z is a step toward it.
  eye.z += floor(hash11(aCommitIndex) * DEPTH_RUNGS) * DEPTH_RUNG;
  gl_Position = projectionMatrix * eye;
}
