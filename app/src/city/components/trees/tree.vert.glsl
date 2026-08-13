// tree.vert.glsl — merged tree chunks: vertices arrive pre-transformed to
// world space with all colors baked per-vertex (see treeRenderer's bake).
// Deliberately no instancing: instanced tree draws corrupt on mobile GPU
// drivers (Samsung Xclipse 950, both browser GL stacks); this is the same
// draw shape as roads, which never glitched. The commit index rides along
// for the timeline scrub gate (fragment discard).

attribute float aCommitIndex;

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

void main() {
  vColor = color;
  vCommitIndex = aCommitIndex;
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  // The camera looks down -Z in eye space, so +Z is a step toward it.
  eye.z += floor(hash11(aCommitIndex) * DEPTH_RUNGS) * DEPTH_RUNG;
  gl_Position = projectionMatrix * eye;
}
